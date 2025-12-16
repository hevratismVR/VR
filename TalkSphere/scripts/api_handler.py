#!/usr/bin/env python3
"""
TalkSphere - Claude API Handler
Handles all API calls to Claude for generating Hebrew word database content.
"""

import anthropic
import json
import time
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from pathlib import Path
import os

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class APIConfig:
    """Configuration for Claude API calls."""
    model: str = "claude-sonnet-4-20250514"
    max_tokens: int = 8192
    temperature: float = 0.7
    max_retries: int = 3
    retry_delay: float = 2.0
    rate_limit_delay: float = 0.5  # Delay between requests


class ClaudeAPIHandler:
    """Handles Claude API interactions for TalkSphere content generation."""

    def __init__(self, api_key: Optional[str] = None, config: Optional[APIConfig] = None):
        """
        Initialize the API handler.

        Args:
            api_key: Anthropic API key. If None, reads from ANTHROPIC_API_KEY env var.
            config: API configuration. Uses defaults if None.
        """
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError("API key required. Set ANTHROPIC_API_KEY environment variable.")

        self.config = config or APIConfig()
        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.request_count = 0
        self.last_request_time = 0

    def _rate_limit(self):
        """Implement rate limiting between requests."""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.config.rate_limit_delay:
            time.sleep(self.config.rate_limit_delay - elapsed)
        self.last_request_time = time.time()

    def _build_system_prompt(self) -> str:
        """Build the system prompt for Hebrew content generation."""
        return """אתה מומחה ליצירת תוכן חינוכי בעברית עבור ילדים עם אוטיזם.

הנחיות חשובות:
1. כל התוכן חייב להיות בעברית טבעית ופשוטה
2. השתמש בשפה מילולית וברורה - הימנע מסרקזם, מטאפורות מורכבות, וביטויים מופשטים
3. טוקי התוכי הוא הדמות המלווה - הוא תמיד חיובי, מעודד וסבלני
4. הקפד על מבנה צפוי ועקבי
5. כלול תמיד תיאורים של תמיכות חזותיות
6. הימנע מכל תוכן שלילי, מפחיד או מלחיץ
7. חגוג כל מאמץ והצלחה
8. התאם תוכן לגילאים 4-18 עם דגש על פשטות

פורמט הפלט:
- החזר תמיד JSON תקין
- ודא שכל השדות הנדרשים קיימים
- כלול מגוון רחב של תוכן
- הקפד על ייחודיות - הימנע מחזרות"""

    def _build_category_prompt(
        self,
        word: str,
        word_nikud: str,
        transliteration: str,
        translation: str,
        category_info: Dict[str, Any],
        batch_num: int = 1,
        total_batches: int = 1
    ) -> str:
        """
        Build a prompt for generating content for a specific category.

        Args:
            word: Hebrew word without nikud
            word_nikud: Hebrew word with nikud
            transliteration: English transliteration
            translation: English translation
            category_info: Category template information
            batch_num: Current batch number (for splitting large generations)
            total_batches: Total number of batches

        Returns:
            Formatted prompt string
        """
        items_per_batch = category_info['target_items'] // total_batches
        start_item = (batch_num - 1) * items_per_batch + 1
        end_item = batch_num * items_per_batch

        structure_desc = json.dumps(category_info['structure'], ensure_ascii=False, indent=2)

        prompt = f"""צור תוכן עבור הקטגוריה: {category_info['name_he']} ({category_info['name']})

המילה: {word} ({word_nikud})
תעתיק: {transliteration}
תרגום: {translation}

מבנה הפלט הנדרש:
{structure_desc}

הנחיות ספציפיות:
{category_info['prompt_template'].format(word=word, transliteration=transliteration)}

דרישות:
1. צור פריטים {start_item} עד {end_item} (סה"כ {items_per_batch} פריטים בקירוב לכל שדה)
2. כל התוכן בעברית פשוטה ומותאמת לילדים עם אוטיזם
3. טוקי התוכי משתמש בשפה חיובית ומעודדת
4. הקפד על מגוון - הימנע מחזרות
5. כלול תיאורי תמיכה חזותית היכן שרלוונטי

החזר JSON תקין בלבד, ללא טקסט נוסף."""

        return prompt

    def generate_content(
        self,
        word: str,
        word_nikud: str,
        transliteration: str,
        translation: str,
        category_info: Dict[str, Any],
        batch_num: int = 1,
        total_batches: int = 1
    ) -> Optional[Dict[str, Any]]:
        """
        Generate content for a word category using Claude API.

        Args:
            word: Hebrew word
            word_nikud: Hebrew word with nikud
            transliteration: English transliteration
            translation: English translation
            category_info: Category template
            batch_num: Batch number for large generations
            total_batches: Total batches

        Returns:
            Generated content as dictionary, or None if failed
        """
        self._rate_limit()

        prompt = self._build_category_prompt(
            word, word_nikud, transliteration, translation,
            category_info, batch_num, total_batches
        )

        for attempt in range(self.config.max_retries):
            try:
                logger.info(f"API call: {word} - {category_info['name']} (attempt {attempt + 1})")

                response = self.client.messages.create(
                    model=self.config.model,
                    max_tokens=self.config.max_tokens,
                    temperature=self.config.temperature,
                    system=self._build_system_prompt(),
                    messages=[
                        {"role": "user", "content": prompt}
                    ]
                )

                self.request_count += 1

                # Extract text content
                content = response.content[0].text

                # Try to parse JSON from response
                # Handle potential markdown code blocks
                if "```json" in content:
                    content = content.split("```json")[1].split("```")[0]
                elif "```" in content:
                    content = content.split("```")[1].split("```")[0]

                result = json.loads(content.strip())
                logger.info(f"Successfully generated content for {word} - {category_info['name']}")
                return result

            except json.JSONDecodeError as e:
                logger.warning(f"JSON parse error for {word} - {category_info['name']}: {e}")
                if attempt < self.config.max_retries - 1:
                    time.sleep(self.config.retry_delay * (attempt + 1))

            except anthropic.RateLimitError as e:
                logger.warning(f"Rate limit hit, waiting... {e}")
                time.sleep(self.config.retry_delay * 5)

            except anthropic.APIError as e:
                logger.error(f"API error for {word} - {category_info['name']}: {e}")
                if attempt < self.config.max_retries - 1:
                    time.sleep(self.config.retry_delay * (attempt + 1))

            except Exception as e:
                logger.error(f"Unexpected error for {word} - {category_info['name']}: {e}")
                if attempt < self.config.max_retries - 1:
                    time.sleep(self.config.retry_delay)

        logger.error(f"Failed to generate content for {word} - {category_info['name']} after {self.config.max_retries} attempts")
        return None

    def generate_full_category(
        self,
        word: str,
        word_nikud: str,
        transliteration: str,
        translation: str,
        category_info: Dict[str, Any],
        target_items: int = 2000
    ) -> Optional[Dict[str, Any]]:
        """
        Generate full content for a category, potentially in multiple batches.

        Large categories are split into batches to avoid token limits.

        Args:
            word: Hebrew word
            word_nikud: Hebrew word with nikud
            transliteration: English transliteration
            translation: English translation
            category_info: Category template
            target_items: Target number of items

        Returns:
            Complete category content, or None if failed
        """
        # Calculate number of batches needed (roughly 500 items per batch to stay within limits)
        items_per_batch = 400
        num_batches = max(1, (target_items + items_per_batch - 1) // items_per_batch)

        logger.info(f"Generating {category_info['name']} for '{word}' in {num_batches} batches")

        all_content = {}

        for batch in range(1, num_batches + 1):
            batch_content = self.generate_content(
                word, word_nikud, transliteration, translation,
                category_info, batch, num_batches
            )

            if batch_content is None:
                logger.error(f"Batch {batch}/{num_batches} failed for {word} - {category_info['name']}")
                continue

            # Merge batch content
            for key, value in batch_content.items():
                if key in all_content and isinstance(value, list):
                    all_content[key].extend(value)
                else:
                    all_content[key] = value

        if not all_content:
            return None

        # Add metadata
        all_content['word'] = word
        all_content['word_nikud'] = word_nikud
        all_content['word_id'] = f"{transliteration.lower()}_{word}"
        all_content['category'] = category_info['id']
        all_content['generated_batches'] = num_batches

        return all_content

    def get_stats(self) -> Dict[str, Any]:
        """Get API usage statistics."""
        return {
            "total_requests": self.request_count,
            "model": self.config.model,
            "max_tokens": self.config.max_tokens
        }


class ContentGenerator:
    """High-level content generation orchestrator."""

    def __init__(self, api_handler: ClaudeAPIHandler, templates_path: str):
        """
        Initialize the content generator.

        Args:
            api_handler: Claude API handler instance
            templates_path: Path to category templates JSON
        """
        self.api = api_handler
        self.templates = self._load_templates(templates_path)

    def _load_templates(self, path: str) -> Dict[str, Any]:
        """Load category templates from JSON file."""
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def generate_word_content(
        self,
        word_data: Dict[str, str],
        output_dir: str,
        categories: Optional[List[str]] = None
    ) -> Dict[str, bool]:
        """
        Generate all category content for a single word.

        Args:
            word_data: Word information dict with keys: word, word_nikud, transliteration, translation_en
            output_dir: Directory to save generated content
            categories: Optional list of category IDs to generate. If None, generates all.

        Returns:
            Dict mapping category IDs to success status
        """
        word = word_data['word']
        word_nikud = word_data.get('word_nikud', word)
        transliteration = word_data.get('transliteration', '')
        translation = word_data.get('translation_en', '')

        # Create output directory
        folder_name = f"{word_data.get('id', '000'):03d}_{transliteration.lower()}"
        word_output_dir = Path(output_dir) / folder_name
        word_output_dir.mkdir(parents=True, exist_ok=True)

        results = {}
        category_list = self.templates['categories']

        if categories:
            category_list = [c for c in category_list if c['id'] in categories]

        for i, category in enumerate(category_list, 1):
            logger.info(f"Processing category {i}/{len(category_list)}: {category['name_he']}")

            content = self.api.generate_full_category(
                word, word_nikud, transliteration, translation,
                category, category['target_items']
            )

            if content:
                output_file = word_output_dir / category['filename']
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(content, f, ensure_ascii=False, indent=2)
                results[category['id']] = True
                logger.info(f"Saved: {output_file}")
            else:
                results[category['id']] = False
                logger.error(f"Failed to generate: {category['name']}")

        return results


# Utility functions for direct script usage
def test_api_connection() -> bool:
    """Test if API connection works."""
    try:
        handler = ClaudeAPIHandler()
        client = handler.client
        # Simple test call
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=100,
            messages=[{"role": "user", "content": "אמור שלום בעברית"}]
        )
        print(f"API connection successful: {response.content[0].text}")
        return True
    except Exception as e:
        print(f"API connection failed: {e}")
        return False


if __name__ == "__main__":
    # Test the API connection
    print("Testing Claude API connection...")
    test_api_connection()
