import base64
import io
import os
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, jsonify, render_template, request
from PIL import Image

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FACES_DIR = DATA_DIR / "faces"
MODEL_DIR = DATA_DIR / "models"
DB_PATH = DATA_DIR / "face_system.db"
MODEL_PATH = MODEL_DIR / "lbph_model.yml"
LABELS_PATH = MODEL_DIR / "labels.txt"

for folder in (FACES_DIR, MODEL_DIR):
    folder.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024
db_lock = threading.Lock()
model_lock = threading.Lock()
recognizer = None
label_to_name = {}
model_ready = False
last_logged = {}
LOG_COOLDOWN_SECONDS = 60
FACE_SIZE = (160, 160)


def connect_db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    with connect_db() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS people (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                person_name TEXT NOT NULL,
                status TEXT NOT NULL,
                confidence REAL,
                event_time TEXT NOT NULL
            )
        """)
        con.commit()


def now_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def decode_image(data_url):
    if not data_url:
        raise ValueError("No image was supplied.")
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    raw = base64.b64decode(data_url)
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    arr = np.array(image)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def face_detector():
    path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    detector = cv2.CascadeClassifier(path)
    if detector.empty():
        raise RuntimeError("OpenCV face detector could not be loaded.")
    return detector


DETECTOR = face_detector()


def get_faces(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    faces = DETECTOR.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5, minSize=(55, 55)
    )
    return gray, faces


def load_model():
    global recognizer, label_to_name, model_ready
    if not hasattr(cv2, "face") or not hasattr(cv2.face, "LBPHFaceRecognizer_create"):
        model_ready = False
        return
    if MODEL_PATH.exists() and LABELS_PATH.exists():
        try:
            rec = cv2.face.LBPHFaceRecognizer_create()
            rec.read(str(MODEL_PATH))
            mapping = {}
            for line in LABELS_PATH.read_text(encoding="utf-8").splitlines():
                if "\t" in line:
                    key, name = line.split("\t", 1)
                    mapping[int(key)] = name
            with model_lock:
                recognizer = rec
                label_to_name = mapping
                model_ready = bool(mapping)
        except Exception:
            model_ready = False


def train_model():
    global recognizer, label_to_name, model_ready
    if not hasattr(cv2, "face") or not hasattr(cv2.face, "LBPHFaceRecognizer_create"):
        return False, "LBPH is unavailable. Install opencv-contrib-python in this environment."
    images, labels, mapping = [], [], {}
    with connect_db() as con:
        people = con.execute("SELECT id, name FROM people ORDER BY id").fetchall()
    for person in people:
        folder = FACES_DIR / str(person["id"])
        if not folder.exists():
            continue
        count = 0
        for file in folder.glob("*.jpg"):
            image = cv2.imread(str(file), cv2.IMREAD_GRAYSCALE)
            if image is None:
                continue
            image = cv2.resize(image, FACE_SIZE)
            images.append(image)
            labels.append(int(person["id"]))
            count += 1
        if count:
            mapping[int(person["id"])] = person["name"]
    if not images:
        with model_lock:
            model_ready = False
        return False, "No saved face samples yet. Register a person first."
    rec = cv2.face.LBPHFaceRecognizer_create()
    rec.train(images, np.array(labels, dtype=np.int32))
    rec.write(str(MODEL_PATH))
    LABELS_PATH.write_text(
        "\n".join(f"{key}\t{name}" for key, name in mapping.items()), encoding="utf-8"
    )
    with model_lock:
        recognizer = rec
        label_to_name = mapping
        model_ready = True
    return True, f"Model trained with {len(images)} face samples across {len(mapping)} people."


def log_event(name, status, confidence=None):
    key = f"{name}:{status}"
    now = time.time()
    if now - last_logged.get(key, 0) < LOG_COOLDOWN_SECONDS:
        return
    last_logged[key] = now
    with db_lock, connect_db() as con:
        con.execute(
            "INSERT INTO events(person_name, status, confidence, event_time) VALUES (?, ?, ?, ?)",
            (name, status, confidence, now_text()),
        )
        con.commit()


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/status")
def api_status():
    with connect_db() as con:
        people = con.execute("SELECT COUNT(*) n FROM people").fetchone()["n"]
        events = con.execute("SELECT COUNT(*) n FROM events").fetchone()["n"]
        today = datetime.now().strftime("%Y-%m-%d") + "%"
        today_count = con.execute(
            "SELECT COUNT(*) n FROM events WHERE status='Recognized' AND event_time LIKE ?", (today,)
        ).fetchone()["n"]
    return jsonify({
        "ok": True, "people": people, "events": events,
        "today_recognitions": today_count, "model_ready": model_ready,
        "recognition_available": hasattr(cv2, "face") and hasattr(cv2.face, "LBPHFaceRecognizer_create")
    })


@app.get("/api/people")
def api_people():
    with connect_db() as con:
        rows = con.execute("""
            SELECT p.id, p.name, p.created_at,
                   (SELECT COUNT(*) FROM events e WHERE e.person_name=p.name AND e.status='Recognized') AS recognition_count
            FROM people p ORDER BY p.name COLLATE NOCASE
        """).fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/api/events")
def api_events():
    limit = min(max(request.args.get("limit", default=100, type=int), 1), 500)
    with connect_db() as con:
        rows = con.execute(
            "SELECT id, person_name, status, confidence, event_time FROM events ORDER BY id DESC LIMIT ?",
            (limit,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/register")
def api_register():
    payload = request.get_json(silent=True) or {}
    name = " ".join(str(payload.get("name", "")).strip().split())
    images = payload.get("images") or []
    if not name:
        return jsonify({"ok": False, "error": "Please enter a person's name."}), 400
    if len(name) > 80:
        return jsonify({"ok": False, "error": "Name must be 80 characters or fewer."}), 400
    if not images:
        return jsonify({"ok": False, "error": "Capture at least one face image first."}), 400
    if len(images) > 12:
        return jsonify({"ok": False, "error": "Please submit no more than 12 samples at once."}), 400

    saved_faces = []
    for data in images:
        frame = decode_image(data)
        gray, faces = get_faces(frame)
        if len(faces) == 0:
            continue
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        face = cv2.resize(gray[y:y+h, x:x+w], FACE_SIZE)
        saved_faces.append(face)
    if not saved_faces:
        return jsonify({"ok": False, "error": "No face detected in the captured samples. Improve lighting and try again."}), 400

    with db_lock:
        try:
            with connect_db() as con:
                cur = con.execute(
                    "INSERT INTO people(name, created_at) VALUES (?, ?)", (name, now_text())
                )
                person_id = cur.lastrowid
                con.commit()
        except sqlite3.IntegrityError:
            return jsonify({"ok": False, "error": "That name is already registered. Use a unique name or remove the existing entry first."}), 409

    folder = FACES_DIR / str(person_id)
    folder.mkdir(parents=True, exist_ok=True)
    for i, face in enumerate(saved_faces, start=1):
        cv2.imwrite(str(folder / f"sample_{i:02d}.jpg"), face)
    ok, message = train_model()
    return jsonify({
        "ok": True, "name": name, "samples_saved": len(saved_faces),
        "model_trained": ok, "message": f"Registered {name} with {len(saved_faces)} usable sample(s). {message}"
    })


@app.post("/api/recognize")
def api_recognize():
    payload = request.get_json(silent=True) or {}
    try:
        frame = decode_image(payload.get("image", ""))
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Could not read image: {exc}"}), 400

    gray, faces = get_faces(frame)
    results = []
    with model_lock:
        rec = recognizer
        mapping = dict(label_to_name)
        ready = model_ready
    for (x, y, w, h) in faces:
        label, confidence, name, status = -1, None, "Unknown", "Unknown"
        if ready and rec is not None:
            crop = cv2.resize(gray[y:y+h, x:x+w], FACE_SIZE)
            try:
                label, confidence = rec.predict(crop)
                # LBPH distance is lower for a closer match; threshold must be calibrated for your camera/data.
                if label in mapping and confidence < 72:
                    name, status = mapping[label], "Recognized"
            except cv2.error:
                pass
        log_event(name, status, round(float(confidence), 2) if confidence is not None else None)
        results.append({
            "x": int(x), "y": int(y), "w": int(w), "h": int(h),
            "name": name, "status": status,
            "confidence": round(float(confidence), 1) if confidence is not None else None
        })
    return jsonify({"ok": True, "faces": results, "face_count": len(results), "model_ready": ready})


@app.post("/api/train")
def api_train():
    ok, message = train_model()
    return jsonify({"ok": ok, "message": message}), (200 if ok else 400)


@app.post("/api/people/delete")
def api_delete_person():
    payload = request.get_json(silent=True) or {}
    try:
        person_id = int(payload.get("id"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Invalid person ID."}), 400
    with db_lock, connect_db() as con:
        person = con.execute("SELECT name FROM people WHERE id=?", (person_id,)).fetchone()
        if not person:
            return jsonify({"ok": False, "error": "Person not found."}), 404
        name = person["name"]
        con.execute("DELETE FROM people WHERE id=?", (person_id,))
        con.execute("DELETE FROM events WHERE person_name=?", (name,))
        con.commit()
    import shutil
    shutil.rmtree(FACES_DIR / str(person_id), ignore_errors=True)
    ok, message = train_model()
    return jsonify({"ok": True, "message": f"Deleted {name}. {message}"})


init_db()
load_model()

if __name__ == "__main__":
    print("\nFace Recognition System")
    print("Open http://127.0.0.1:5000 in your browser.")
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
