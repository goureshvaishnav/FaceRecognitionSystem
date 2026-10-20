# Real-Time Face Detection and Recognition System

A Python-based web application for detecting and recognizing registered faces using OpenCV. The project combines computer vision, a Flask web interface, and SQLite to provide a simple face registration and recognition workflow.

## Features

- **Face Detection:** Detects faces in camera frames using OpenCV Haar Cascade.
- **Face Recognition:** Uses the Local Binary Patterns Histograms (LBPH) recognizer to identify registered participants.
- **Face Registration:** Register participants and collect face samples for model training.
- **Model Training:** Train the recognition model using collected face samples.
- **Web Dashboard:** Access the application through a browser using Flask.
- **Database Integration:** Store participant records and recognition activity in SQLite.
- **Activity Monitoring:** View recorded recognition events through the dashboard.
- **CSV Export:** Export activity records for further analysis, if enabled in the application.

## Technology Stack

| Component | Technology |
|---|---|
| Programming language | Python |
| Computer vision | OpenCV |
| Face detection | Haar Cascade |
| Face recognition | LBPH |
| Backend | Flask |
| Database | SQLite |
| Frontend | HTML, CSS, JavaScript |

## Project Structure

```text
FaceRecognitionSystem/
├── app.py
├── requirements.txt
├── README.md
├── .gitignore
├── templates/
│   └── index.html
├── static/
│   ├── style.css
│   └── app.js
└── data/
    ├── faces/
    └── models/
```

## Prerequisites

- Python 3.12 recommended
- pip
- A modern web browser
- A webcam, if using live camera recognition

## Installation and Setup

### 1. Clone the repository

```bash
git clone https://github.com/goureshvaishnav/FaceRecognitionSystem.git
cd FaceRecognitionSystem
```

### 2. Create a virtual environment

**Windows PowerShell:**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Run the application

```bash
python app.py
```

### 5. Open the dashboard

Visit the following address in your browser:

http://127.0.0.1:5000

Keep the terminal running while using the application.

## How to Use

1. Start the Flask application.
2. Open the dashboard in your browser.
3. Register a participant who has explicitly agreed to participate.
4. Capture the required face samples.
5. Train the recognition model.
6. Start recognition and test it with a registered participant.
7. Review the activity log and export records if the feature is available.

*The exact controls depend on the current implementation of the application.*

## How It Works

1. **Image capture:** The application obtains image frames from the camera.
2. **Face detection:** Haar Cascade identifies potential face regions.
3. **Preprocessing:** Detected face regions are prepared for recognition.
4. **Training:** The LBPH recognizer learns patterns from registered face samples.
5. **Recognition:** A detected face is compared against the trained model.
6. **Record keeping:** Participant information and recognition events can be stored in SQLite.

## Troubleshooting

### `ModuleNotFoundError: No module named 'cv2'`

Install the OpenCV package used by this project:

```bash
python -m pip install opencv-contrib-python
```

### `requirements.txt` not found

Make sure the terminal is open in the project root directory, where `app.py` and `requirements.txt` are located.

### Camera not working

Check browser camera permissions, confirm the webcam is available, and close other applications that may be using it.

### Application will not start

Activate the virtual environment, install the dependencies, and review the complete terminal error message.

## Privacy and Responsible Use

- Obtain informed consent before registering or recognizing anyone.
- Use only face samples you are authorized to collect.
- Protect stored face images, database records, and trained models.
- Avoid using this educational project for consequential decisions or covert surveillance.
- Delete collected data when it is no longer needed.

## Limitations

Recognition performance depends on lighting, camera quality, face angle, training samples, and the recognition threshold. Haar Cascade and LBPH are classical computer-vision methods and may be less robust than modern deep-learning systems.

## Future Improvements

- Add stronger authentication and access controls.
- Improve performance under different lighting conditions.
- Add configurable data-retention and deletion options.
- Evaluate recognition accuracy using a documented test dataset.
- Explore modern face-embedding approaches.

## Author

**Gouresh Vaishnav**

GitHub: https://github.com/goureshvaishnav

## License

No license has been specified yet. Add an appropriate open-source license if you intend to permit others to use, modify, or redistribute this project.
