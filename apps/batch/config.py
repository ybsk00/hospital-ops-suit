"""배치 워커 설정"""
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://hos_admin:changeme@localhost:5432/hospital_ops')
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379')

FOLDERS = {
    'INPATIENT': os.getenv('BATCH_INPATIENT_DIR', r'C:\EMR_EXPORT\INPATIENT'),
    'OUTPATIENT': os.getenv('BATCH_OUTPATIENT_DIR', r'C:\EMR_EXPORT\OUTPATIENT'),
    'LAB': os.getenv('BATCH_LAB_DIR', r'C:\EMR_EXPORT\LAB'),
}
ERROR_FOLDER = os.getenv('BATCH_ERROR_DIR', r'C:\EMR_EXPORT\ERROR')
ARCHIVE_FOLDER = os.getenv('BATCH_ARCHIVE_DIR', r'C:\EMR_EXPORT\ARCHIVE')

FILE_STABLE_WAIT_SEC = int(os.getenv('BATCH_FILE_STABLE_WAIT_SEC', '10'))
RECEIPT_MODE = os.getenv('BATCH_RECEIPT_MODE', 'done_signal')  # done_signal | eof_marker | stable_size

ALERT_WEBHOOK_URL = os.getenv('ALERT_WEBHOOK_URL', '')
HEALTH_CHECK_INTERVAL_MINUTES = 30
MAX_BATCH_GAP_HOURS = 5

BATCH_SCHEDULE_TIMES = ['10:00', '13:10', '17:00']
