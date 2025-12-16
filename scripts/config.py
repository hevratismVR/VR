"""
TalkSphere Configuration
========================
API settings, paths, and generation parameters for the Hebrew word database generator.
"""

import os
from pathlib import Path

# =============================================================================
# API CONFIGURATION
# =============================================================================

# Claude API Settings
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "your-api-key-here")
CLAUDE_MODEL = "claude-sonnet-4-20250514"  # Or claude-opus-4-20250514 for highest quality

# API Rate Limits and Retry Settings
MAX_RETRIES = 5
INITIAL_RETRY_DELAY = 2  # seconds
MAX_RETRY_DELAY = 60  # seconds
RETRY_MULTIPLIER = 2  # exponential backoff multiplier

# Request Settings
REQUEST_TIMEOUT = 120  # seconds
MAX_TOKENS = 4096
TEMPERATURE = 0.7

# Rate Limiting
REQUESTS_PER_MINUTE = 50
DELAY_BETWEEN_REQUESTS = 1.2  # seconds (to stay within rate limits)

# =============================================================================
# PATH CONFIGURATION
# =============================================================================

# Base Paths
BASE_DIR = Path(__file__).parent.parent
INPUT_DIR = BASE_DIR / "input"
OUTPUT_DIR = BASE_DIR / "output" / "words"
TEMPLATES_DIR = BASE_DIR / "templates"
SCRIPTS_DIR = BASE_DIR / "scripts"

# Input Files
EXCEL_INPUT_FILE = INPUT_DIR / "words_1000.xlsx"
EXCEL_SHEET_NAME = "Sheet1"
WORD_COLUMN = "word"  # Column name containing Hebrew words

# Checkpoint and Log Files
CHECKPOINT_FILE = BASE_DIR / "checkpoint.json"
LOG_FILE = BASE_DIR / "generation.log"
ERROR_LOG_FILE = BASE_DIR / "errors.log"

# =============================================================================
# GENERATION SETTINGS
# =============================================================================

# Content Generation Parameters
ITEMS_PER_CATEGORY = 2000  # Number of items to generate per category per word
BATCH_SIZE = 100  # Items per API call (for efficiency)

# Processing Settings
SAVE_AFTER_EACH_CATEGORY = True  # Save checkpoint after each category
SAVE_AFTER_EACH_WORD = True  # Save checkpoint after each word
CONTINUE_ON_ERROR = True  # Continue to next word if error occurs

# =============================================================================
# CATEGORY DEFINITIONS
# =============================================================================

CATEGORIES = {
    "01_basic": {
        "name": "מידע בסיסי",
        "description": "Basic word information including definition, meaning, and usage",
        "items_count": 2000
    },
    "02_grammar": {
        "name": "דקדוק",
        "description": "Grammar rules, conjugations, and linguistic patterns",
        "items_count": 2000
    },
    "03_questions": {
        "name": "שאלות",
        "description": "Questions using the word in various contexts",
        "items_count": 2000
    },
    "04_correct_responses": {
        "name": "תגובות נכונות",
        "description": "Correct responses and answers related to the word",
        "items_count": 2000
    },
    "05_incorrect_responses": {
        "name": "תגובות שגויות",
        "description": "Common mistakes and incorrect usages for learning",
        "items_count": 2000
    },
    "06_pronunciation": {
        "name": "הגייה",
        "description": "Pronunciation guides, syllables, and phonetic information",
        "items_count": 2000
    },
    "07_sentences": {
        "name": "משפטים",
        "description": "Example sentences using the word in context",
        "items_count": 2000
    },
    "08_related_words": {
        "name": "מילים קשורות",
        "description": "Synonyms, antonyms, and semantically related words",
        "items_count": 2000
    },
    "09_social_situations": {
        "name": "מצבים חברתיים",
        "description": "Social scenarios where the word is used",
        "items_count": 2000
    },
    "10_emotions": {
        "name": "רגשות",
        "description": "Emotional contexts and feelings associated with the word",
        "items_count": 2000
    },
    "11_age_adaptations": {
        "name": "התאמות גיל",
        "description": "Age-appropriate variations and explanations",
        "items_count": 2000
    },
    "12_autism_adaptations": {
        "name": "התאמות אוטיזם",
        "description": "Autism-friendly adaptations and sensory considerations",
        "items_count": 2000
    },
    "13_pragmatics": {
        "name": "פרגמטיקה",
        "description": "Pragmatic language use and social communication",
        "items_count": 2000
    },
    "14_games": {
        "name": "משחקים",
        "description": "Games and activities for learning the word",
        "items_count": 2000
    },
    "15_stories": {
        "name": "סיפורים",
        "description": "Short stories featuring the word",
        "items_count": 2000
    },
    "16_conversation_mechanics": {
        "name": "מכניקת שיחה",
        "description": "Turn-taking, topic maintenance, and conversation skills",
        "items_count": 2000
    },
    "17_speech_acts": {
        "name": "מעשי דיבור",
        "description": "Speech acts: requests, commands, promises, etc.",
        "items_count": 2000
    },
    "18_nonverbal": {
        "name": "תקשורת לא מילולית",
        "description": "Non-verbal communication cues and body language",
        "items_count": 2000
    },
    "19_teaching_strategies": {
        "name": "אסטרטגיות הוראה",
        "description": "Teaching methods and therapeutic strategies",
        "items_count": 2000
    },
    "20_phonetics": {
        "name": "פונטיקה",
        "description": "Detailed phonetic analysis and sound patterns",
        "items_count": 2000
    },
    "21_narrative": {
        "name": "נרטיב",
        "description": "Narrative structures and storytelling elements",
        "items_count": 2000
    },
    "22_fallbacks": {
        "name": "תגובות חלופיות",
        "description": "Fallback responses and error handling phrases",
        "items_count": 2000
    },
    "23_vr_integration": {
        "name": "אינטגרציית VR",
        "description": "VR environment integration and 3D world scenarios",
        "items_count": 2000
    },
    "24_metadata": {
        "name": "מטא-דאטה",
        "description": "Metadata, tags, and categorization information",
        "items_count": 2000
    }
}

# =============================================================================
# TUKI (טוקי) CHARACTER CONFIGURATION
# =============================================================================

TUKI_CONFIG = {
    "name": "טוקי",
    "name_english": "Tuki",
    "character_type": "parrot",
    "personality": [
        "ידידותי וחם",
        "סבלני ומעודד",
        "משתמש בהומור עדין",
        "מותאם לילדים עם אוטיזם",
        "ברור ועקבי בתקשורת"
    ],
    "speaking_style": {
        "tone": "warm_friendly",
        "pace": "slow_clear",
        "repetition": True,
        "visual_cues": True,
        "positive_reinforcement": True
    },
    "phrases": {
        "greeting": "שלום! אני טוקי התוכי!",
        "encouragement": "יופי! עשית עבודה מצוינת!",
        "try_again": "בוא ננסה שוב יחד!",
        "success": "מדהים! הצלחת!",
        "thinking": "הממ... בוא נחשוב על זה יחד...",
        "goodbye": "להתראות! היה כיף ללמוד איתך!"
    }
}

# =============================================================================
# THERAPEUTIC SETTINGS
# =============================================================================

THERAPEUTIC_CONFIG = {
    "target_audience": "children_with_autism",
    "age_range": {
        "min": 3,
        "max": 12
    },
    "communication_levels": [
        "pre_verbal",
        "single_words",
        "phrases",
        "sentences",
        "conversation"
    ],
    "sensory_considerations": [
        "visual_supports",
        "auditory_clarity",
        "predictable_patterns",
        "reduced_complexity"
    ],
    "therapeutic_approaches": [
        "ABA",
        "TEACCH",
        "DIR_Floortime",
        "Social_Stories",
        "Visual_Schedules"
    ]
}

# =============================================================================
# LOGGING CONFIGURATION
# =============================================================================

LOGGING_CONFIG = {
    "level": "INFO",
    "format": "%(asctime)s - %(levelname)s - %(message)s",
    "date_format": "%Y-%m-%d %H:%M:%S",
    "file_mode": "a",  # append mode
    "console_output": True,
    "file_output": True
}

# =============================================================================
# VALIDATION SETTINGS
# =============================================================================

VALIDATION = {
    "min_items_per_category": 1900,  # Minimum acceptable items (95%)
    "max_empty_fields": 0.05,  # Maximum 5% empty fields allowed
    "required_fields": ["id", "content", "type"],
    "hebrew_only": True,  # Ensure all content is in Hebrew
    "validate_json": True  # Validate JSON structure before saving
}
