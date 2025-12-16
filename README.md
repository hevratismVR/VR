# TalkSphere Hebrew Word Database Generator

מערכת ליצירת מאגר מילים עברי מקיף לילדים עם אוטיזם, בליווי טוקי התוכי.

## Overview

TalkSphere generates a comprehensive Hebrew word database for therapeutic language learning:
- **1000 Hebrew words** processed automatically
- **24 categories** of content per word
- **~2000 items** per category
- **Total: 48,000,000 items** of therapeutic content

## Project Structure

```
TalkSphere/
├── input/                    # Input Excel file with 1000 words
│   └── words_1000.xlsx
├── output/
│   └── words/               # Generated JSON files (1000 folders)
│       ├── אבא/
│       │   ├── 01_basic.json
│       │   ├── 02_grammar.json
│       │   └── ... (24 files)
│       └── ...
├── scripts/
│   ├── config.py            # Configuration and settings
│   ├── api_handler.py       # Claude API with retry logic
│   ├── generator.py         # Main generation script
│   └── create_sample_excel.py
├── templates/               # JSON templates for 24 categories
│   ├── 01_basic.json
│   ├── 02_grammar.json
│   └── ... (24 templates)
├── requirements.txt
└── README.md
```

## Categories (24)

| # | Category | Hebrew | Description |
|---|----------|--------|-------------|
| 01 | Basic | מידע בסיסי | Definitions, meanings, usage |
| 02 | Grammar | דקדוק | Conjugations, tenses, patterns |
| 03 | Questions | שאלות | Comprehension questions |
| 04 | Correct Responses | תגובות נכונות | Modeled appropriate answers |
| 05 | Incorrect Responses | תגובות שגויות | Common errors for learning |
| 06 | Pronunciation | הגייה | Phonetic guides, syllables |
| 07 | Sentences | משפטים | Example sentences |
| 08 | Related Words | מילים קשורות | Synonyms, antonyms, families |
| 09 | Social Situations | מצבים חברתיים | Social scenarios |
| 10 | Emotions | רגשות | Emotional contexts |
| 11 | Age Adaptations | התאמות גיל | Age-appropriate versions |
| 12 | Autism Adaptations | התאמות אוטיזם | Autism-friendly content |
| 13 | Pragmatics | פרגמטיקה | Social communication rules |
| 14 | Games | משחקים | Learning activities |
| 15 | Stories | סיפורים | Short stories |
| 16 | Conversation | מכניקת שיחה | Turn-taking, dialogue |
| 17 | Speech Acts | מעשי דיבור | Requests, promises, etc. |
| 18 | Nonverbal | תקשורת לא מילולית | Body language, gestures |
| 19 | Teaching | אסטרטגיות הוראה | Therapeutic strategies |
| 20 | Phonetics | פונטיקה | Sound analysis |
| 21 | Narrative | נרטיב | Story structures |
| 22 | Fallbacks | תגובות חלופיות | Error recovery phrases |
| 23 | VR Integration | אינטגרציית VR | 3D world scenarios |
| 24 | Metadata | מטא-דאטה | Tags and categorization |

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/talksphere.git
cd talksphere

# Install dependencies
pip install -r requirements.txt

# Set up API key
export ANTHROPIC_API_KEY="your-api-key-here"
```

## Usage

### Create Sample Excel File
```bash
python scripts/create_sample_excel.py
```

### Run Generator
```bash
# Start/resume full generation
python scripts/generator.py

# Generate for specific word
python scripts/generator.py --word אבא

# Check progress status
python scripts/generator.py --status

# Reset and start fresh
python scripts/generator.py --reset

# Validate generated content
python scripts/generator.py --validate
```

## Features

### Automation
- **Overnight Processing**: Runs continuously without stopping
- **Checkpointing**: Saves progress after each word/category
- **Resume Support**: Automatically resumes from interruption
- **Progress Logging**: `Word 156/1000 - Category 12/24 - אבא`

### Content
- **All Hebrew**: 100% Hebrew content
- **Autism-Adapted**: Designed for children with autism
- **Tuki Character**: טוקי the parrot as friendly AI companion
- **Therapeutically Sound**: Based on ABA, TEACCH, DIR/Floortime

### Technical
- **Exponential Backoff**: Automatic retry on API errors
- **Rate Limiting**: Respects API limits
- **Error Handling**: Continues on errors, logs failures
- **JSON Validation**: Validates output structure

## Configuration

Edit `scripts/config.py` to customize:
- API settings (model, tokens, temperature)
- Paths and directories
- Items per category (default: 2000)
- Retry logic parameters
- Tuki character settings

## Output Format

Each word generates 24 JSON files:

```json
{
  "word": "אבא",
  "word_index": 0,
  "category_id": "01_basic",
  "category_name": "מידע בסיסי",
  "generated_at": "2024-01-15T10:30:00",
  "items_count": 2000,
  "items": [
    {
      "id": "אבא_01_basic_0",
      "word": "אבא",
      "category": "01_basic",
      "type": "definition",
      "content": {...},
      "difficulty": 1,
      "age_range": {"min": 3, "max": 12},
      "tuki_says": "שלום! בוא נלמד על המילה אבא!",
      "autism_adaptations": {...}
    }
  ]
}
```

## Tuki (טוקי) Character

Tuki is a friendly parrot who guides children through learning:
- **Personality**: Warm, patient, encouraging
- **Speaking Style**: Slow, clear, with repetition
- **Visual Cues**: Color-coded, predictable patterns
- **Positive Reinforcement**: Celebrates every success

## License

MIT License - See LICENSE file for details.

## Support

For questions or issues, please open a GitHub issue.

---

**TalkSphere** - Helping children learn Hebrew, one word at a time. 🦜
