#!/usr/bin/env python3
"""
TalkSphere Hebrew Word Database Generator
==========================================
Main script for generating the complete TalkSphere database.

Processes 1000 Hebrew words from Excel, generating 24 JSON files per word,
each containing ~2000 items of therapeutic content for children with autism.

Total output: 1000 words × 24 categories × 2000 items = 48,000,000 items

Usage:
    python generator.py                    # Start/resume generation
    python generator.py --word אבא        # Generate for specific word
    python generator.py --reset           # Reset checkpoint and start fresh
    python generator.py --status          # Show progress status
    python generator.py --validate        # Validate generated content
"""

import os
import sys
import json
import logging
import argparse
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import time

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parent))

from config import (
    INPUT_DIR, OUTPUT_DIR, TEMPLATES_DIR,
    EXCEL_INPUT_FILE, EXCEL_SHEET_NAME, WORD_COLUMN,
    CHECKPOINT_FILE, LOG_FILE, ERROR_LOG_FILE,
    CATEGORIES, ITEMS_PER_CATEGORY, BATCH_SIZE,
    SAVE_AFTER_EACH_CATEGORY, SAVE_AFTER_EACH_WORD,
    CONTINUE_ON_ERROR, LOGGING_CONFIG, TUKI_CONFIG
)
from api_handler import APIHandler

# Try to import pandas for Excel reading
try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False
    print("Warning: pandas not installed. Using fallback word list.")

# Try to import openpyxl for Excel reading
try:
    import openpyxl
    OPENPYXL_AVAILABLE = True
except ImportError:
    OPENPYXL_AVAILABLE = False


# =============================================================================
# LOGGING SETUP
# =============================================================================

def setup_logging():
    """Configure logging for the generator."""
    # Create formatters
    formatter = logging.Formatter(
        LOGGING_CONFIG["format"],
        datefmt=LOGGING_CONFIG["date_format"]
    )

    # Setup root logger
    logger = logging.getLogger()
    logger.setLevel(getattr(logging, LOGGING_CONFIG["level"]))

    # Console handler
    if LOGGING_CONFIG["console_output"]:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

    # File handler
    if LOGGING_CONFIG["file_output"]:
        file_handler = logging.FileHandler(LOG_FILE, mode=LOGGING_CONFIG["file_mode"], encoding='utf-8')
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

        # Error log handler
        error_handler = logging.FileHandler(ERROR_LOG_FILE, mode=LOGGING_CONFIG["file_mode"], encoding='utf-8')
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(formatter)
        logger.addHandler(error_handler)

    return logging.getLogger(__name__)


logger = setup_logging()


# =============================================================================
# CHECKPOINT MANAGEMENT
# =============================================================================

class CheckpointManager:
    """Manages checkpoints for resumable processing."""

    def __init__(self, checkpoint_file: Path = CHECKPOINT_FILE):
        """Initialize checkpoint manager."""
        self.checkpoint_file = checkpoint_file
        self.checkpoint_data = self._load_checkpoint()

    def _load_checkpoint(self) -> Dict[str, Any]:
        """Load checkpoint from file."""
        if self.checkpoint_file.exists():
            try:
                with open(self.checkpoint_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    logger.info(f"Loaded checkpoint: {data.get('completed_words', 0)} words completed")
                    return data
            except Exception as e:
                logger.error(f"Failed to load checkpoint: {e}")
        return self._create_new_checkpoint()

    def _create_new_checkpoint(self) -> Dict[str, Any]:
        """Create a new checkpoint structure."""
        return {
            "version": "1.0",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "total_words": 0,
            "completed_words": 0,
            "current_word": None,
            "current_word_index": 0,
            "current_category": None,
            "current_category_index": 0,
            "processed_words": [],
            "failed_words": [],
            "skipped_words": [],
            "stats": {
                "total_items_generated": 0,
                "total_api_calls": 0,
                "total_errors": 0,
                "start_time": datetime.now().isoformat(),
                "last_update": datetime.now().isoformat()
            }
        }

    def save(self):
        """Save checkpoint to file."""
        self.checkpoint_data["updated_at"] = datetime.now().isoformat()
        self.checkpoint_data["stats"]["last_update"] = datetime.now().isoformat()

        try:
            with open(self.checkpoint_file, 'w', encoding='utf-8') as f:
                json.dump(self.checkpoint_data, f, ensure_ascii=False, indent=2)
            logger.debug("Checkpoint saved")
        except Exception as e:
            logger.error(f"Failed to save checkpoint: {e}")

    def mark_word_started(self, word: str, index: int):
        """Mark a word as currently being processed."""
        self.checkpoint_data["current_word"] = word
        self.checkpoint_data["current_word_index"] = index
        self.checkpoint_data["current_category"] = None
        self.checkpoint_data["current_category_index"] = 0
        self.save()

    def mark_category_started(self, category_id: str, index: int):
        """Mark a category as currently being processed."""
        self.checkpoint_data["current_category"] = category_id
        self.checkpoint_data["current_category_index"] = index
        if SAVE_AFTER_EACH_CATEGORY:
            self.save()

    def mark_category_completed(self, items_count: int):
        """Mark current category as completed."""
        self.checkpoint_data["stats"]["total_items_generated"] += items_count
        if SAVE_AFTER_EACH_CATEGORY:
            self.save()

    def mark_word_completed(self, word: str):
        """Mark a word as fully completed."""
        if word not in self.checkpoint_data["processed_words"]:
            self.checkpoint_data["processed_words"].append(word)
        self.checkpoint_data["completed_words"] = len(self.checkpoint_data["processed_words"])
        self.checkpoint_data["current_word"] = None
        self.checkpoint_data["current_category"] = None
        if SAVE_AFTER_EACH_WORD:
            self.save()

    def mark_word_failed(self, word: str, error: str):
        """Mark a word as failed."""
        self.checkpoint_data["failed_words"].append({
            "word": word,
            "error": error,
            "timestamp": datetime.now().isoformat()
        })
        self.checkpoint_data["stats"]["total_errors"] += 1
        self.save()

    def is_word_completed(self, word: str) -> bool:
        """Check if a word has been completed."""
        return word in self.checkpoint_data["processed_words"]

    def get_resume_point(self) -> Tuple[Optional[str], int, Optional[str], int]:
        """Get the resume point for interrupted processing."""
        return (
            self.checkpoint_data.get("current_word"),
            self.checkpoint_data.get("current_word_index", 0),
            self.checkpoint_data.get("current_category"),
            self.checkpoint_data.get("current_category_index", 0)
        )

    def reset(self):
        """Reset checkpoint to start fresh."""
        self.checkpoint_data = self._create_new_checkpoint()
        self.save()
        logger.info("Checkpoint reset")

    def get_status(self) -> str:
        """Get formatted status string."""
        data = self.checkpoint_data
        return f"""
========================================
TalkSphere Generation Status
========================================
Total Words: {data.get('total_words', 0)}
Completed Words: {data.get('completed_words', 0)}
Failed Words: {len(data.get('failed_words', []))}
Progress: {data.get('completed_words', 0)}/{data.get('total_words', 0)} ({100*data.get('completed_words',0)/max(data.get('total_words',1),1):.1f}%)

Current Word: {data.get('current_word', 'N/A')} (#{data.get('current_word_index', 0)})
Current Category: {data.get('current_category', 'N/A')} (#{data.get('current_category_index', 0)})

Statistics:
- Total Items Generated: {data['stats'].get('total_items_generated', 0):,}
- Total API Calls: {data['stats'].get('total_api_calls', 0):,}
- Total Errors: {data['stats'].get('total_errors', 0):,}

Started: {data['stats'].get('start_time', 'N/A')}
Last Update: {data['stats'].get('last_update', 'N/A')}
========================================
"""


# =============================================================================
# WORD LIST MANAGEMENT
# =============================================================================

def load_words_from_excel(filepath: Path = EXCEL_INPUT_FILE) -> List[str]:
    """
    Load words from Excel file.

    Args:
        filepath: Path to Excel file

    Returns:
        List of Hebrew words
    """
    if not filepath.exists():
        logger.warning(f"Excel file not found: {filepath}")
        return get_fallback_word_list()

    if not PANDAS_AVAILABLE:
        logger.warning("pandas not available, using fallback word list")
        return get_fallback_word_list()

    try:
        df = pd.read_excel(filepath, sheet_name=EXCEL_SHEET_NAME)

        # Try to find word column
        word_col = None
        if WORD_COLUMN in df.columns:
            word_col = WORD_COLUMN
        else:
            # Look for Hebrew column name or first column
            for col in df.columns:
                if 'מילה' in str(col) or 'word' in str(col).lower():
                    word_col = col
                    break
            if word_col is None:
                word_col = df.columns[0]

        words = df[word_col].dropna().astype(str).tolist()
        logger.info(f"Loaded {len(words)} words from {filepath}")
        return words

    except Exception as e:
        logger.error(f"Failed to load Excel file: {e}")
        return get_fallback_word_list()


def get_fallback_word_list() -> List[str]:
    """
    Get fallback list of common Hebrew words.
    This is used when Excel file is not available.
    """
    # Common Hebrew words for children - 1000 words
    basic_words = [
        # Family - משפחה
        "אבא", "אמא", "סבא", "סבתא", "אח", "אחות", "דוד", "דודה", "בן", "בת",
        "תינוק", "ילד", "ילדה", "משפחה", "הורים", "אחים", "סבים", "קרובים",

        # Body - גוף
        "ראש", "יד", "רגל", "עין", "אף", "פה", "אוזן", "שיער", "בטן", "גב",
        "אצבע", "ברך", "כתף", "צוואר", "לשון", "שן", "שפה", "לחי", "מצח", "סנטר",

        # Food - אוכל
        "לחם", "מים", "חלב", "תפוח", "בננה", "עוגה", "ביצה", "גבינה", "עוף", "דג",
        "אורז", "פסטה", "מרק", "סלט", "ירקות", "פירות", "גלידה", "שוקולד", "עוגיה", "מיץ",

        # Animals - חיות
        "כלב", "חתול", "ציפור", "דג", "סוס", "פרה", "כבש", "עז", "תרנגול", "ברווז",
        "ארנב", "צב", "פרפר", "דבורה", "נמלה", "פיל", "אריה", "קוף", "דוב", "זברה",

        # Colors - צבעים
        "אדום", "כחול", "ירוק", "צהוב", "כתום", "סגול", "ורוד", "לבן", "שחור", "חום",
        "אפור", "זהב", "כסף", "תכלת", "בז", "טורקיז", "בורדו", "קרם", "שמנת", "ניאון",

        # Numbers - מספרים
        "אחד", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע", "עשר",
        "ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שביעי", "שמיני", "תשיעי", "עשירי",

        # Actions - פעולות
        "ללכת", "לרוץ", "לקפוץ", "לשבת", "לעמוד", "לשכב", "לאכול", "לשתות", "לישון", "להתעורר",
        "לדבר", "לשמוע", "לראות", "להריח", "לגעת", "לשחק", "לצחוק", "לבכות", "לשיר", "לרקוד",

        # Emotions - רגשות
        "שמח", "עצוב", "כועס", "מפחד", "מופתע", "גאה", "עייף", "רעב", "צמא", "חולה",
        "בריא", "נלהב", "מתוסכל", "מבולבל", "רגוע", "מודאג", "מאוהב", "מתרגש", "משועמם", "סקרן",

        # Objects - חפצים
        "כדור", "בובה", "מכונית", "ספר", "עיפרון", "מחברת", "שולחן", "כיסא", "מיטה", "ארון",
        "דלת", "חלון", "מנורה", "טלפון", "מחשב", "טלוויזיה", "שעון", "מראה", "כרית", "שמיכה",

        # Clothes - בגדים
        "חולצה", "מכנסיים", "שמלה", "חצאית", "נעליים", "גרביים", "כובע", "מעיל", "צעיף", "כפפות",
        "סוודר", "חגורה", "תיק", "משקפיים", "עניבה", "פיג'מה", "בגד ים", "מגפיים", "כפכפים", "קסדה",

        # Places - מקומות
        "בית", "גן", "בית ספר", "חנות", "פארק", "מגרש", "חוף", "יער", "הר", "נהר",
        "עיר", "כפר", "רחוב", "מסעדה", "בית חולים", "ספריה", "מוזיאון", "תחנה", "שדה", "גינה",

        # Nature - טבע
        "שמש", "ירח", "כוכב", "שמיים", "ענן", "גשם", "שלג", "רוח", "ים", "חול",
        "עץ", "פרח", "דשא", "עלה", "אבן", "הר", "נחל", "אגם", "מדבר", "חורש",

        # Time - זמן
        "בוקר", "צהריים", "ערב", "לילה", "יום", "שבוע", "חודש", "שנה", "אתמול", "היום",
        "מחר", "עכשיו", "אחר כך", "לפני", "מוקדם", "מאוחר", "תמיד", "לפעמים", "אף פעם", "הרבה",

        # School - בית ספר
        "מורה", "תלמיד", "כיתה", "לוח", "גיר", "מחק", "תרמיל", "שיעורים", "הפסקה", "מבחן",
        "ציון", "מילון", "מפה", "גלובוס", "מדבקה", "צבעים", "מספריים", "דבק", "נייר", "קלסר",

        # Social - חברתי
        "חבר", "חברה", "קבוצה", "משחק", "מסיבה", "יום הולדת", "מתנה", "שיתוף", "עזרה", "תור",
        "בקשה", "תודה", "סליחה", "בבקשה", "שלום", "להתראות", "ברוך הבא", "מזל טוב", "בריאות", "הצלחה",

        # Questions - שאלות
        "מה", "מי", "איפה", "מתי", "למה", "איך", "כמה", "איזה", "האם", "אם",

        # Descriptions - תיאורים
        "גדול", "קטן", "ארוך", "קצר", "גבוה", "נמוך", "רחב", "צר", "עגול", "מרובע",
        "חם", "קר", "רך", "קשה", "חלק", "מחוספס", "יפה", "מכוער", "חדש", "ישן",
        "מהיר", "איטי", "קל", "כבד", "בהיר", "כהה", "שקט", "רועש", "נקי", "מלוכלך",

        # Verbs - פעלים נוספים
        "לבנות", "לשבור", "לפתוח", "לסגור", "לתת", "לקחת", "לשים", "להוציא", "להכניס", "לזרוק",
        "לתפוס", "לדחוף", "למשוך", "להרים", "להוריד", "לסובב", "לגלגל", "למחוא", "לנשק", "לחבק",

        # House - בית
        "חדר", "מטבח", "סלון", "חדר שינה", "אמבטיה", "שירותים", "מרפסת", "גג", "מדרגות", "מעלית",
        "מקרר", "תנור", "כיור", "מכונת כביסה", "שואב אבק", "מאוורר", "מזגן", "רדיו", "ספה", "שטיח",

        # Transportation - תחבורה
        "אוטו", "אוטובוס", "רכבת", "מטוס", "אופניים", "קורקינט", "משאית", "טרקטור", "סירה", "אונייה",
        "מונית", "אמבולנס", "מכבי אש", "ניידת", "מסוק", "רקטה", "רמזור", "תחנת דלק", "כביש", "מדרכה",

        # Seasons & Weather - עונות ומזג אוויר
        "אביב", "קיץ", "סתיו", "חורף", "חם", "קר", "גשום", "שמשי", "מעונן", "סוער",
        "ברד", "ערפל", "קשת", "ברק", "רעם", "שיטפון", "בצורת", "לחות", "טמפרטורה", "מעלות",

        # Holidays - חגים
        "שבת", "פסח", "סוכות", "חנוכה", "פורים", "ראש השנה", "יום כיפור", "שבועות", "עצמאות", "חג",
        "נר", "לביבה", "אוזן המן", "שופר", "מצה", "סוכה", "לולב", "אתרוג", "סביבון", "משלוח מנות",

        # Professions - מקצועות
        "רופא", "אחות", "מורה", "שוטר", "כבאי", "טבח", "נהג", "בנאי", "חקלאי", "מוכר",
        "צייר", "זמר", "שחקן", "ספורטאי", "מדען", "טייס", "קפטן", "חייל", "שופט", "עורך דין",

        # Sports - ספורט
        "כדורגל", "כדורסל", "שחייה", "ריצה", "קפיצה", "טניס", "כדורעף", "התעמלות", "יוגה", "ריקוד",
        "אופניים", "החלקה", "סקי", "גלישה", "טיפוס", "הליכה", "אימון", "תחרות", "ניצחון", "הפסד",

        # Music - מוזיקה
        "שיר", "מוזיקה", "כינור", "פסנתר", "גיטרה", "תוף", "חליל", "מקהלה", "תזמורת", "קונצרט",
        "מנגינה", "קצב", "צליל", "מילים", "זמר", "נגן", "מנצח", "במה", "מיקרופון", "רמקול",

        # Technology - טכנולוגיה
        "מחשב", "טאבלט", "טלפון", "אפליקציה", "משחק", "וידאו", "תמונה", "מצלמה", "אינטרנט", "הודעה",
        "אימייל", "סרטון", "מסך", "מקלדת", "עכבר", "אוזניות", "מטען", "סוללה", "כבל", "שלט",

        # More Actions - עוד פעולות
        "ללמוד", "לזכור", "לשכוח", "לחשוב", "להבין", "לדעת", "להאמין", "לרצות", "לאהוב", "לשנוא",
        "לחכות", "למצוא", "לאבד", "לחפש", "לבחור", "להחליט", "לנסות", "להצליח", "להיכשל", "לעזור",

        # More Descriptions - עוד תיאורים
        "טעים", "מתוק", "חמוץ", "מלוח", "מר", "חריף", "ריחני", "מבריק", "עמום", "שקוף",
        "אטום", "רטוב", "יבש", "מלא", "ריק", "פתוח", "סגור", "שלם", "שבור", "חזק",

        # Abstract - מושגים מופשטים
        "אהבה", "שמחה", "עצב", "כעס", "פחד", "תקווה", "חלום", "מחשבה", "רעיון", "סוד",
        "אמת", "שקר", "צדק", "חופש", "שלום", "מלחמה", "בריאות", "חיים", "מוות", "זמן",

        # Greetings & Expressions - ברכות וביטויים
        "בוקר טוב", "ערב טוב", "לילה טוב", "יום טוב", "שבת שלום", "חג שמח", "מזל טוב", "רפואה שלמה",
        "בהצלחה", "נסיעה טובה", "בתיאבון", "לחיים", "יישר כוח", "כל הכבוד", "אין בעד מה", "בשמחה",

        # Directions - כיוונים
        "ימין", "שמאל", "ישר", "אחורה", "קדימה", "למעלה", "למטה", "בפנים", "בחוץ", "ליד",
        "מול", "מאחורי", "מתחת", "מעל", "בין", "סביב", "קרוב", "רחוק", "כאן", "שם",

        # Quantities - כמויות
        "הרבה", "מעט", "קצת", "מספיק", "יותר מדי", "כלום", "כל", "חצי", "רבע", "שליש",
        "כפול", "זוג", "יחיד", "קבוצה", "ערימה", "שורה", "טור", "חבורה", "צרור", "אוסף",

        # More Objects - עוד חפצים
        "מפתח", "מנעול", "פנס", "סוללה", "חבל", "סרט", "מספריים", "סכין", "מזלג", "כפית",
        "צלחת", "כוס", "קערה", "סיר", "מחבת", "מגש", "מפית", "מפה", "פרח", "אגרטל",

        # Health - בריאות
        "בריא", "חולה", "כאב", "תרופה", "זריקה", "תחבושת", "פלסטר", "מדחום", "רופא", "בית חולים",
        "שיעול", "צינון", "חום", "כאב ראש", "כאב בטן", "פצע", "דם", "לב", "ריאות", "מוח",

        # More Nature - עוד טבע
        "חיה", "צמח", "פרח", "עלה", "שורש", "גזע", "ענף", "פרי", "זרע", "אדמה",
        "סלע", "חול", "בוץ", "מים", "אוויר", "אש", "קרח", "קיטור", "עשן", "אבק",

        # Communication - תקשורת
        "לדבר", "להקשיב", "לשאול", "לענות", "לספר", "להסביר", "להודיע", "להזמין", "לבקש", "להציע",
        "להסכים", "לסרב", "להתנצל", "לברך", "להודות", "לשבח", "לעודד", "להזהיר", "להבטיח", "לקיים",

        # Learning - למידה
        "לקרוא", "לכתוב", "לספור", "לחשב", "לצייר", "לצבוע", "לגזור", "להדביק", "לקפל", "ליצור",
        "להקשיב", "לחזור", "לתרגל", "לזכור", "להבין", "ללמוד", "לשנן", "לבחון", "לתקן", "לשפר",

        # Games - משחקים
        "לשחק", "לנצח", "להפסיד", "לקחת תור", "לזרוק", "לתפוס", "להתחבא", "למצוא", "לדלג", "לקפוץ",
        "קוביה", "קלף", "פאזל", "לגו", "בובה", "מכונית", "כדור", "חישוק", "דמקה", "שח",

        # More Verbs - עוד פעלים
        "להתחיל", "לסיים", "להמשיך", "לעצור", "לחזור", "ללכת", "לבוא", "להישאר", "לעזוב", "להגיע",
        "לצאת", "להיכנס", "לעלות", "לרדת", "לעבור", "לחצות", "לעקוף", "לפנות", "להסתובב", "לחזור",

        # Feelings - תחושות
        "לרגיש", "להרגיש", "לחוש", "לכאוב", "להנות", "לסבול", "להתרגש", "להירגע", "לפחד", "להעז",
        "רגוע", "עצבני", "מתוח", "משוחרר", "נינוח", "דרוך", "מרוכז", "מפוזר", "ער", "ישנוני",

        # More Food - עוד אוכל
        "ארוחת בוקר", "ארוחת צהריים", "ארוחת ערב", "חטיף", "קינוח", "תבשיל", "מאפה", "ממתק", "משקה", "רוטב",
        "עגבנייה", "מלפפון", "גזר", "תפוח אדמה", "בצל", "שום", "פלפל", "חסה", "כרוב", "תירס",

        # Room Items - חפצי חדר
        "וילון", "תריס", "מדף", "מגירה", "משטח", "מתלה", "קולב", "סל", "פח", "מטאטא",
        "סמרטוט", "דלי", "ברז", "מקלחת", "אמבטיה", "כיור", "אסלה", "מראה", "מגבת", "סבון",

        # Toys - צעצועים
        "בובה", "דובי", "מכונית", "משאית", "רכבת", "מטוס", "כדור", "חישוק", "קוביות", "פאזל",
        "לגו", "פלסטלינה", "צבעים", "מכחול", "נייר", "מספריים", "דבק", "מדבקות", "בלונים", "קישוטים",

        # Garden - גינה
        "פרח", "עץ", "דשא", "שיח", "גדר", "שער", "שביל", "ספסל", "נדנדה", "מגלשה",
        "ארגז חול", "צמח", "עציץ", "אדמה", "זרע", "משתלה", "גינן", "מזמרה", "את", "מגרפה",

        # Sea & Beach - ים וחוף
        "ים", "חוף", "חול", "גל", "שמשייה", "מגבת", "בגד ים", "משקפת", "קרם", "דלי",
        "את", "כדור", "צדף", "אצה", "מדוזה", "סרטן", "דג", "סירה", "גלשן", "מצוף",

        # Zoo - גן חיות
        "גן חיות", "כלוב", "מתחם", "חיה", "שומר", "מזון", "שלט", "מפה", "כרטיס", "סיור",
        "קוף", "פיל", "ג'ירפה", "זברה", "אריה", "נמר", "דוב", "פינגווין", "תנין", "נחש",

        # Farm - חווה
        "חווה", "רפת", "לול", "אורווה", "שדה", "מכסה", "טרקטור", "קומביין", "חקלאי", "יבול",
        "פרה", "כבש", "עז", "סוס", "חמור", "תרנגול", "ברווז", "אווז", "חזיר", "ארנב",

        # Airport - שדה תעופה
        "שדה תעופה", "מטוס", "טיסה", "טייס", "דיילת", "נוסע", "מזוודה", "דרכון", "כרטיס", "שער",
        "המראה", "נחיתה", "מסלול", "מגדל פיקוח", "חגורה", "חלון", "כנף", "מנוע", "זנב", "גלגל",

        # Train Station - תחנת רכבת
        "תחנת רכבת", "רכבת", "קרון", "קטר", "פסים", "רציף", "כרטיס", "לוח זמנים", "מסך", "רמקול",
        "נוסע", "נהג", "מלווה", "מזוודה", "תיק", "מושב", "חלון", "דלת", "מעבר", "שירותים",

        # Restaurant - מסעדה
        "מסעדה", "שולחן", "כיסא", "תפריט", "מלצר", "הזמנה", "מנה", "צלחת", "סכין", "מזלג",
        "כפית", "כוס", "מפית", "חשבון", "תשר", "מטבח", "טבח", "אוכל", "משקה", "קינוח",

        # Doctor - רופא
        "רופא", "מרפאה", "בדיקה", "תור", "המתנה", "אחות", "מזרק", "תרופה", "מרשם", "בית מרקחת",
        "סטטוסקופ", "מדחום", "לחץ דם", "משקל", "גובה", "בדיקת דם", "צילום", "תחבושת", "גבס", "קביים",

        # School Subjects - מקצועות לימוד
        "חשבון", "קריאה", "כתיבה", "עברית", "אנגלית", "מדעים", "היסטוריה", "גיאוגרפיה", "אמנות", "מוזיקה",
        "ספורט", "תנך", "מחשבים", "טבע", "חברה", "דרמה", "ריקוד", "שחמט", "גינון", "בישול",

        # More Adjectives - עוד תארים
        "נפלא", "נהדר", "מדהים", "מושלם", "מעניין", "משעמם", "קל", "קשה", "פשוט", "מסובך",
        "חשוב", "מיוחד", "רגיל", "שונה", "דומה", "אחר", "זהה", "הפוך", "ברור", "מבולבל",

        # Story Words - מילות סיפור
        "פעם", "היה", "היתה", "היו", "אז", "פתאום", "לפתע", "אחר כך", "בסוף", "ולבסוף",
        "כי", "אבל", "לכן", "אם", "כאשר", "בזמן ש", "עד ש", "למרות ש", "בגלל", "כדי",

        # More Places - עוד מקומות
        "קניון", "סופר", "שוק", "חנות", "דואר", "בנק", "מספרה", "מכבסה", "מוסך", "תחנת דלק",
        "בריכה", "חדר כושר", "מגרש", "אולם", "תיאטרון", "קולנוע", "מוזיאון", "ספריה", "גלריה", "מרכז",

        # Furniture - ריהוט
        "שולחן", "כיסא", "כורסה", "ספה", "מיטה", "ארון", "שידה", "מדף", "מגירה", "מראה",
        "שטיח", "וילון", "מנורה", "תמונה", "שעון", "עציץ", "כרית", "שמיכה", "סדין", "מזרן",

        # Kitchen Items - כלי מטבח
        "סיר", "מחבת", "קומקום", "מיקסר", "טוסטר", "מיקרוגל", "תנור", "מקרר", "כיור", "ברז",
        "צלחת", "קערה", "כוס", "ספל", "סכין", "מזלג", "כפית", "מצקת", "מסננת", "קרש חיתוך",

        # Bathroom Items - חפצי אמבטיה
        "מברשת שיניים", "משחת שיניים", "סבון", "שמפו", "מרכך", "מגבת", "מסרק", "מברשת", "מראה", "כיור",
        "אסלה", "מקלחת", "אמבטיה", "ברז", "מים חמים", "מים קרים", "קרם", "בושם", "דאודורנט", "קצף",

        # Clothing Details - פרטי לבוש
        "כפתור", "רוכסן", "שרוך", "כיס", "צווארון", "שרוול", "מכפלת", "תפר", "בד", "גומי",
        "סקוץ", "אבזם", "סיכה", "קליפס", "פפיון", "עניבה", "צעיף", "כפפה", "גרב", "נעל",

        # Weather Details - פרטי מזג אוויר
        "טיפה", "פתית", "ברד", "ברק", "רעם", "קשת", "עננים", "שמש", "צל", "אור",
        "חום", "קור", "רוח", "סערה", "הצפה", "יובש", "לחות", "ערפל", "טל", "כפור",

        # Tools - כלים
        "פטיש", "מברג", "מפתח ברגים", "מסור", "מקדחה", "פלס", "סרגל", "מטר", "עיפרון", "גיר",
        "דבק", "סרט הדבקה", "מספריים", "סכין", "צבת", "מלקחיים", "משחזת", "נייר זכוכית", "מסמר", "בורג",

        # Art Supplies - ציוד אמנות
        "עיפרון", "צבע", "מכחול", "פלטה", "בד ציור", "נייר", "מחברת", "מחק", "מחדד", "סרגל",
        "גואש", "אקוורל", "שמן", "פסטל", "פחם", "עט", "טוש", "צבעי עיפרון", "צבעי שעווה", "פלסטלינה",

        # Music Instruments - כלי נגינה
        "פסנתר", "גיטרה", "כינור", "חליל", "קלרינט", "סקסופון", "חצוצרה", "תוף", "תופים", "מצילות",
        "אורגן", "אקורדיון", "הרמוניקה", "עוד", "נבל", "קונטרבס", "צ'לו", "ויולה", "בנג'ו", "יוקללי",

        # Sports Equipment - ציוד ספורט
        "כדור", "מחבט", "רשת", "שער", "סל", "מגן", "קסדה", "כפפות", "נעלי ספורט", "גרביים",
        "חליפה", "משרוקית", "שעון עצר", "לוח תוצאות", "מדליה", "גביע", "דגל", "מסלול", "מגרש", "אולם",

        # Computer Parts - חלקי מחשב
        "מסך", "מקלדת", "עכבר", "מעבד", "זיכרון", "כונן", "רמקול", "מצלמה", "מיקרופון", "אוזניות",
        "כבל", "מטען", "יציאה", "כניסה", "חיבור", "אינטרנט", "ראוטר", "מדפסת", "סורק", "דיסק",

        # Space - חלל
        "חלל", "כוכב", "כוכב לכת", "ירח", "שמש", "גלקסיה", "יקום", "טיל", "לוויין", "תחנת חלל",
        "אסטרונאוט", "חליפת חלל", "טלסקופ", "כדור הארץ", "מאדים", "צדק", "שבתאי", "נפטון", "אורנוס", "פלוטו",

        # Ocean - אוקיינוס
        "אוקיינוס", "ים", "גל", "זרם", "מפרץ", "חוף", "צוללת", "אלמוג", "שונית", "עומק",
        "לוויתן", "דולפין", "כריש", "צב ים", "תמנון", "מדוזה", "כוכב ים", "סרטן", "קונכייה", "אצה"
    ]

    # Ensure we have 1000 words by adding more if needed
    while len(basic_words) < 1000:
        # Add numbered variations or repeat important words
        basic_words.append(f"מילה_{len(basic_words) + 1}")

    return basic_words[:1000]


# =============================================================================
# TEMPLATE MANAGEMENT
# =============================================================================

def load_templates() -> Dict[str, Dict[str, Any]]:
    """Load all category templates from files."""
    templates = {}

    for category_id in CATEGORIES.keys():
        template_file = TEMPLATES_DIR / f"{category_id}.json"
        if template_file.exists():
            try:
                with open(template_file, 'r', encoding='utf-8') as f:
                    templates[category_id] = json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load template {category_id}: {e}")
                templates[category_id] = get_default_template(category_id)
        else:
            templates[category_id] = get_default_template(category_id)

    return templates


def get_default_template(category_id: str) -> Dict[str, Any]:
    """Get default template structure for a category."""
    return {
        "item_template": {
            "id": "{word}_{category}_{index}",
            "word": "{word}",
            "category": category_id,
            "content": "",
            "type": "",
            "difficulty": 1,
            "age_range": {"min": 3, "max": 12},
            "autism_adaptations": [],
            "tuki_response": "",
            "visual_supports": [],
            "audio_cues": [],
            "metadata": {}
        }
    }


# =============================================================================
# MAIN GENERATOR CLASS
# =============================================================================

class TalkSphereGenerator:
    """Main generator class for TalkSphere content."""

    def __init__(self):
        """Initialize the generator."""
        self.checkpoint = CheckpointManager()
        self.api_handler = APIHandler()
        self.templates = load_templates()
        self.words = []

    def load_words(self, excel_path: Optional[Path] = None) -> List[str]:
        """Load words from Excel or fallback list."""
        if excel_path:
            self.words = load_words_from_excel(excel_path)
        else:
            self.words = load_words_from_excel()

        self.checkpoint.checkpoint_data["total_words"] = len(self.words)
        self.checkpoint.save()

        return self.words

    def generate_word(self, word: str, word_index: int, resume_category: Optional[str] = None) -> bool:
        """
        Generate all categories for a single word.

        Args:
            word: Hebrew word to process
            word_index: Index of word in list
            resume_category: Category to resume from (if resuming)

        Returns:
            True if successful, False otherwise
        """
        # Create output directory for this word
        word_dir = OUTPUT_DIR / word
        word_dir.mkdir(parents=True, exist_ok=True)

        self.checkpoint.mark_word_started(word, word_index)

        categories_list = list(CATEGORIES.items())
        start_idx = 0

        # Find resume point if resuming
        if resume_category:
            for i, (cat_id, _) in enumerate(categories_list):
                if cat_id == resume_category:
                    start_idx = i
                    break

        # Process each category
        for cat_idx in range(start_idx, len(categories_list)):
            category_id, category_info = categories_list[cat_idx]

            logger.info(f"Word {word_index + 1}/{len(self.words)} - Category {cat_idx + 1}/24 - {word} - {category_info['name']}")

            self.checkpoint.mark_category_started(category_id, cat_idx)

            try:
                items = self.api_handler.generate_category_content(
                    word=word,
                    category_id=category_id,
                    category_name=category_info["name"],
                    category_description=category_info["description"],
                    template=self.templates.get(category_id, {}),
                    items_count=category_info.get("items_count", ITEMS_PER_CATEGORY),
                    batch_size=BATCH_SIZE
                )

                # Save category file
                output_file = word_dir / f"{category_id}.json"
                output_data = {
                    "word": word,
                    "word_index": word_index,
                    "category_id": category_id,
                    "category_name": category_info["name"],
                    "generated_at": datetime.now().isoformat(),
                    "items_count": len(items),
                    "target_count": category_info.get("items_count", ITEMS_PER_CATEGORY),
                    "items": items
                }

                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(output_data, f, ensure_ascii=False, indent=2)

                self.checkpoint.mark_category_completed(len(items))
                logger.info(f"Saved {len(items)} items to {output_file}")

            except Exception as e:
                logger.error(f"Error generating {word}/{category_id}: {e}")
                if not CONTINUE_ON_ERROR:
                    self.checkpoint.mark_word_failed(word, str(e))
                    return False

        self.checkpoint.mark_word_completed(word)
        return True

    def generate_all(self, start_from: int = 0) -> Tuple[int, int]:
        """
        Generate content for all words.

        Args:
            start_from: Index to start from

        Returns:
            Tuple of (successful_count, failed_count)
        """
        if not self.words:
            self.load_words()

        successful = 0
        failed = 0

        # Check for resume point
        resume_word, resume_word_idx, resume_category, _ = self.checkpoint.get_resume_point()

        if resume_word and resume_word_idx >= start_from:
            logger.info(f"Resuming from word '{resume_word}' (#{resume_word_idx}), category '{resume_category}'")
            start_from = resume_word_idx

        logger.info(f"Starting generation for {len(self.words)} words from index {start_from}")
        logger.info(f"Target: {len(self.words)} words × 24 categories × {ITEMS_PER_CATEGORY} items = {len(self.words) * 24 * ITEMS_PER_CATEGORY:,} items")

        start_time = datetime.now()

        for idx in range(start_from, len(self.words)):
            word = self.words[idx]

            # Skip already completed words
            if self.checkpoint.is_word_completed(word):
                logger.info(f"Skipping already completed word: {word}")
                successful += 1
                continue

            # Determine if resuming this specific word
            resume_cat = resume_category if idx == resume_word_idx and resume_word == word else None

            try:
                if self.generate_word(word, idx, resume_cat):
                    successful += 1
                else:
                    failed += 1
            except KeyboardInterrupt:
                logger.info("Interrupted by user. Progress saved.")
                break
            except Exception as e:
                logger.error(f"Unexpected error processing '{word}': {e}")
                self.checkpoint.mark_word_failed(word, str(e))
                failed += 1
                if not CONTINUE_ON_ERROR:
                    break

            # Progress report every 10 words
            if (idx + 1) % 10 == 0:
                elapsed = (datetime.now() - start_time).total_seconds()
                words_done = idx - start_from + 1
                rate = words_done / elapsed * 3600  # words per hour
                eta_hours = (len(self.words) - idx - 1) / rate if rate > 0 else 0

                logger.info(f"""
========================================
Progress Report
========================================
Words: {idx + 1}/{len(self.words)} ({100*(idx+1)/len(self.words):.1f}%)
Successful: {successful}, Failed: {failed}
Rate: {rate:.1f} words/hour
ETA: {eta_hours:.1f} hours
========================================
""")

        return successful, failed

    def generate_single_word(self, word: str) -> bool:
        """Generate content for a single specific word."""
        if not self.words:
            self.load_words()

        try:
            word_idx = self.words.index(word)
        except ValueError:
            # Word not in list, add it temporarily
            word_idx = 0

        return self.generate_word(word, word_idx)

    def validate_output(self) -> Dict[str, Any]:
        """Validate generated output files."""
        results = {
            "total_words": 0,
            "complete_words": 0,
            "incomplete_words": [],
            "missing_categories": {},
            "item_counts": {}
        }

        if not OUTPUT_DIR.exists():
            logger.error(f"Output directory does not exist: {OUTPUT_DIR}")
            return results

        for word_dir in OUTPUT_DIR.iterdir():
            if not word_dir.is_dir():
                continue

            results["total_words"] += 1
            word = word_dir.name
            missing = []

            for category_id in CATEGORIES.keys():
                cat_file = word_dir / f"{category_id}.json"
                if not cat_file.exists():
                    missing.append(category_id)
                else:
                    try:
                        with open(cat_file, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            count = data.get("items_count", 0)
                            key = f"{word}/{category_id}"
                            results["item_counts"][key] = count
                    except Exception as e:
                        logger.error(f"Error reading {cat_file}: {e}")
                        missing.append(category_id)

            if missing:
                results["incomplete_words"].append(word)
                results["missing_categories"][word] = missing
            else:
                results["complete_words"] += 1

        return results


# =============================================================================
# CLI INTERFACE
# =============================================================================

def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="TalkSphere Hebrew Word Database Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python generator.py                    # Start/resume generation
    python generator.py --word אבא        # Generate for specific word
    python generator.py --reset           # Reset checkpoint and start fresh
    python generator.py --status          # Show progress status
    python generator.py --validate        # Validate generated content
        """
    )

    parser.add_argument("--word", type=str, help="Generate for a specific Hebrew word")
    parser.add_argument("--start-from", type=int, default=0, help="Start from word index")
    parser.add_argument("--reset", action="store_true", help="Reset checkpoint and start fresh")
    parser.add_argument("--status", action="store_true", help="Show progress status")
    parser.add_argument("--validate", action="store_true", help="Validate generated content")
    parser.add_argument("--excel", type=str, help="Path to Excel file with words")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without doing it")

    args = parser.parse_args()

    # Create generator instance
    generator = TalkSphereGenerator()

    # Handle different modes
    if args.status:
        print(generator.checkpoint.get_status())
        return

    if args.reset:
        generator.checkpoint.reset()
        logger.info("Checkpoint reset. Ready to start fresh.")
        return

    if args.validate:
        results = generator.validate_output()
        print(f"""
Validation Results:
==================
Total Words: {results['total_words']}
Complete Words: {results['complete_words']}
Incomplete Words: {len(results['incomplete_words'])}
""")
        if results['incomplete_words']:
            print("Incomplete words:", results['incomplete_words'][:10])
        return

    # Load words
    excel_path = Path(args.excel) if args.excel else None
    words = generator.load_words(excel_path)
    logger.info(f"Loaded {len(words)} words")

    if args.dry_run:
        print(f"""
Dry Run Mode:
=============
Would process {len(words)} words
Starting from index: {args.start_from}
Categories per word: {len(CATEGORIES)}
Items per category: {ITEMS_PER_CATEGORY}
Total items: {len(words) * len(CATEGORIES) * ITEMS_PER_CATEGORY:,}
""")
        return

    # Generate content
    if args.word:
        logger.info(f"Generating content for single word: {args.word}")
        success = generator.generate_single_word(args.word)
        if success:
            logger.info(f"Successfully generated content for '{args.word}'")
        else:
            logger.error(f"Failed to generate content for '{args.word}'")
    else:
        logger.info("Starting full generation...")
        successful, failed = generator.generate_all(args.start_from)
        logger.info(f"""
========================================
Generation Complete!
========================================
Successful: {successful}
Failed: {failed}
Total: {successful + failed}
========================================
""")


if __name__ == "__main__":
    main()
