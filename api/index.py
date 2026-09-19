import sys
from pathlib import Path

# Make the existing FastAPI package inside /server importable
SERVER_DIR = Path(__file__).resolve().parents[1] / "server"
sys.path.insert(0, str(SERVER_DIR))

from app.main import app
