"""
TalkSphere API Handler
======================
Handles Claude API calls with robust retry logic, rate limiting, and error handling.
"""

import json
import time
import logging
from typing import Optional, Dict, Any, List
from pathlib import Path
import anthropic
from anthropic import APIError, RateLimitError, APIConnectionError

from config import (
    ANTHROPIC_API_KEY,
    CLAUDE_MODEL,
    MAX_RETRIES,
    INITIAL_RETRY_DELAY,
    MAX_RETRY_DELAY,
    RETRY_MULTIPLIER,
    REQUEST_TIMEOUT,
    MAX_TOKENS,
    TEMPERATURE,
    DELAY_BETWEEN_REQUESTS,
    TUKI_CONFIG,
    THERAPEUTIC_CONFIG
)

# Setup logging
logger = logging.getLogger(__name__)


class APIHandler:
    """Handles all Claude API interactions with retry logic and rate limiting."""

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the API handler.

        Args:
            api_key: Anthropic API key. Uses config default if not provided.
        """
        self.api_key = api_key or ANTHROPIC_API_KEY
        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.last_request_time = 0
        self.total_requests = 0
        self.total_tokens_used = 0
        self.errors_count = 0

    def _wait_for_rate_limit(self):
        """Ensure minimum delay between requests."""
        elapsed = time.time() - self.last_request_time
        if elapsed < DELAY_BETWEEN_REQUESTS:
            time.sleep(DELAY_BETWEEN_REQUESTS - elapsed)
        self.last_request_time = time.time()

    def _calculate_retry_delay(self, attempt: int) -> float:
        """
        Calculate delay for retry with exponential backoff.

        Args:
            attempt: Current attempt number (0-indexed)

        Returns:
            Delay in seconds
        """
        delay = INITIAL_RETRY_DELAY * (RETRY_MULTIPLIER ** attempt)
        return min(delay, MAX_RETRY_DELAY)

    def call_api(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None
    ) -> Optional[str]:
        """
        Make an API call with retry logic.

        Args:
            prompt: The user prompt to send
            system_prompt: Optional system prompt
            max_tokens: Maximum tokens in response
            temperature: Sampling temperature

        Returns:
            Response text or None if all retries failed
        """
        max_tokens = max_tokens or MAX_TOKENS
        temperature = temperature or TEMPERATURE

        # Default system prompt for TalkSphere
        if system_prompt is None:
            system_prompt = self._get_default_system_prompt()

        for attempt in range(MAX_RETRIES):
            try:
                self._wait_for_rate_limit()

                logger.debug(f"API call attempt {attempt + 1}/{MAX_RETRIES}")

                response = self.client.messages.create(
                    model=CLAUDE_MODEL,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    system=system_prompt,
                    messages=[
                        {"role": "user", "content": prompt}
                    ]
                )

                self.total_requests += 1
                self.total_tokens_used += response.usage.input_tokens + response.usage.output_tokens

                # Extract text from response
                if response.content and len(response.content) > 0:
                    return response.content[0].text

                logger.warning("Empty response received from API")
                return None

            except RateLimitError as e:
                delay = self._calculate_retry_delay(attempt)
                logger.warning(f"Rate limit hit. Waiting {delay}s before retry {attempt + 1}/{MAX_RETRIES}")
                self.errors_count += 1
                time.sleep(delay)

            except APIConnectionError as e:
                delay = self._calculate_retry_delay(attempt)
                logger.warning(f"Connection error: {e}. Waiting {delay}s before retry {attempt + 1}/{MAX_RETRIES}")
                self.errors_count += 1
                time.sleep(delay)

            except APIError as e:
                delay = self._calculate_retry_delay(attempt)
                logger.error(f"API error: {e}. Waiting {delay}s before retry {attempt + 1}/{MAX_RETRIES}")
                self.errors_count += 1
                time.sleep(delay)

            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                self.errors_count += 1
                if attempt < MAX_RETRIES - 1:
                    delay = self._calculate_retry_delay(attempt)
                    time.sleep(delay)
                else:
                    return None

        logger.error(f"All {MAX_RETRIES} retries failed")
        return None

    def _get_default_system_prompt(self) -> str:
        """Get the default system prompt for TalkSphere content generation."""
        return f"""אתה מומחה ליצירת תוכן חינוכי בעברית לילדים עם אוטיזם.

אתה עוזר ליצור תוכן עבור טוקי ({TUKI_CONFIG['name']}) - תוכי ידידותי שמלווה ילדים בלמידת שפה.

הנחיות חשובות:
1. כל התוכן חייב להיות בעברית בלבד
2. השפה צריכה להיות פשוטה, ברורה ומותאמת לילדים בגילאי {THERAPEUTIC_CONFIG['age_range']['min']}-{THERAPEUTIC_CONFIG['age_range']['max']}
3. התוכן צריך להיות מותאם לילדים עם אוטיזם:
   - משפטים קצרים וברורים
   - חזרתיות ועקביות
   - תמיכה חזותית
   - רגישות לסנסוריקה
   - חיזוקים חיוביים
4. הטון צריך להיות חם, מעודד וסבלני
5. כל תגובה צריכה להיות בפורמט JSON תקני

גישות טיפוליות נתמכות: {', '.join(THERAPEUTIC_CONFIG['therapeutic_approaches'])}

דמות טוקי:
- אישיות: {', '.join(TUKI_CONFIG['personality'])}
- סגנון דיבור: איטי, ברור, עם חזרות ותמיכה חזותית
"""

    def generate_category_content(
        self,
        word: str,
        category_id: str,
        category_name: str,
        category_description: str,
        template: Dict[str, Any],
        items_count: int = 2000,
        batch_size: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Generate content for a specific category.

        Args:
            word: The Hebrew word to generate content for
            category_id: Category identifier (e.g., "01_basic")
            category_name: Hebrew name of the category
            category_description: Description of what to generate
            template: JSON template structure for this category
            items_count: Total number of items to generate
            batch_size: Items per API call

        Returns:
            List of generated items
        """
        all_items = []
        batches_needed = (items_count + batch_size - 1) // batch_size

        logger.info(f"Generating {items_count} items for '{word}' - {category_name}")
        logger.info(f"Will make {batches_needed} API calls ({batch_size} items each)")

        for batch_num in range(batches_needed):
            start_idx = batch_num * batch_size
            end_idx = min(start_idx + batch_size, items_count)
            current_batch_size = end_idx - start_idx

            prompt = self._create_generation_prompt(
                word=word,
                category_id=category_id,
                category_name=category_name,
                category_description=category_description,
                template=template,
                batch_size=current_batch_size,
                start_index=start_idx
            )

            response = self.call_api(prompt)

            if response:
                try:
                    # Try to parse JSON from response
                    items = self._parse_json_response(response)
                    all_items.extend(items)
                    logger.info(f"Batch {batch_num + 1}/{batches_needed}: Generated {len(items)} items")
                except Exception as e:
                    logger.error(f"Failed to parse batch {batch_num + 1}: {e}")
            else:
                logger.error(f"Failed to get response for batch {batch_num + 1}")

            # Progress update
            if (batch_num + 1) % 10 == 0:
                logger.info(f"Progress: {len(all_items)}/{items_count} items ({100*len(all_items)/items_count:.1f}%)")

        return all_items

    def _create_generation_prompt(
        self,
        word: str,
        category_id: str,
        category_name: str,
        category_description: str,
        template: Dict[str, Any],
        batch_size: int,
        start_index: int
    ) -> str:
        """Create a prompt for generating a batch of items."""
        template_str = json.dumps(template, ensure_ascii=False, indent=2)

        return f"""צור {batch_size} פריטים עבור המילה "{word}" בקטגוריה "{category_name}".

תיאור הקטגוריה: {category_description}

מזהה קטגוריה: {category_id}
אינדקס התחלה: {start_index}

תבנית JSON לכל פריט:
{template_str}

הנחיות:
1. צור בדיוק {batch_size} פריטים ייחודיים
2. כל פריט צריך ID ייחודי בפורמט: {word}_{category_id}_N (כאשר N הוא {start_index} + מספר הפריט)
3. כל התוכן בעברית בלבד
4. התוכן מותאם לילדים עם אוטיזם
5. שלב את דמות טוקי התוכי כמורה מלווה
6. החזר JSON תקני בלבד - מערך של {batch_size} אובייקטים

החזר את התשובה כמערך JSON בלבד, ללא טקסט נוסף:
"""

    def _parse_json_response(self, response: str) -> List[Dict[str, Any]]:
        """
        Parse JSON from API response, handling various formats.

        Args:
            response: Raw response text from API

        Returns:
            List of parsed items
        """
        import re

        # Clean up response
        response = response.strip()

        # Extract JSON from markdown code blocks first
        if '```json' in response:
            start = response.find('```json') + 7
            end = response.find('```', start)
            if end > start:
                response = response[start:end].strip()
        elif '```' in response:
            start = response.find('```') + 3
            end = response.find('```', start)
            if end > start:
                json_str = response[start:end].strip()
                if json_str.startswith('['):
                    response = json_str

        # Try to find array brackets
        start = response.find('[')
        end = response.rfind(']') + 1
        if start != -1 and end > start:
            response = response[start:end]

        # Fix common JSON issues
        # Remove trailing commas before ] or }
        response = re.sub(r',(\s*[\]\}])', r'\1', response)
        # Fix unescaped newlines in strings (replace with space)
        response = re.sub(r'(?<!\\)\n(?!["\s\]\},])', ' ', response)

        try:
            return json.loads(response)
        except json.JSONDecodeError as e:
            # Try to salvage partial JSON - extract complete objects
            items = []
            # Find all complete JSON objects
            depth = 0
            start_idx = None
            for i, char in enumerate(response):
                if char == '{':
                    if depth == 0:
                        start_idx = i
                    depth += 1
                elif char == '}':
                    depth -= 1
                    if depth == 0 and start_idx is not None:
                        try:
                            obj_str = response[start_idx:i+1]
                            obj = json.loads(obj_str)
                            items.append(obj)
                        except:
                            pass
                        start_idx = None
            if items:
                logger.info(f"Salvaged {len(items)} items from malformed JSON")
                return items
            raise e

    def get_stats(self) -> Dict[str, Any]:
        """Get API usage statistics."""
        return {
            "total_requests": self.total_requests,
            "total_tokens_used": self.total_tokens_used,
            "errors_count": self.errors_count,
            "success_rate": (self.total_requests - self.errors_count) / max(self.total_requests, 1) * 100
        }


class BatchProcessor:
    """Processes multiple words in batches with checkpointing."""

    def __init__(self, api_handler: APIHandler):
        """
        Initialize batch processor.

        Args:
            api_handler: APIHandler instance to use for API calls
        """
        self.api_handler = api_handler
        self.processed_words = set()
        self.failed_words = []

    def process_word(
        self,
        word: str,
        categories: Dict[str, Dict[str, Any]],
        templates: Dict[str, Dict[str, Any]],
        output_dir: Path
    ) -> bool:
        """
        Process a single word through all categories.

        Args:
            word: Hebrew word to process
            categories: Category definitions
            templates: Category templates
            output_dir: Directory to save output

        Returns:
            True if successful, False otherwise
        """
        word_dir = output_dir / word
        word_dir.mkdir(parents=True, exist_ok=True)

        success = True

        for category_id, category_info in categories.items():
            template = templates.get(category_id, {})

            try:
                items = self.api_handler.generate_category_content(
                    word=word,
                    category_id=category_id,
                    category_name=category_info["name"],
                    category_description=category_info["description"],
                    template=template,
                    items_count=category_info.get("items_count", 2000)
                )

                # Save to file
                output_file = word_dir / f"{category_id}.json"
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump({
                        "word": word,
                        "category_id": category_id,
                        "category_name": category_info["name"],
                        "items_count": len(items),
                        "items": items
                    }, f, ensure_ascii=False, indent=2)

                logger.info(f"Saved {len(items)} items to {output_file}")

            except Exception as e:
                logger.error(f"Failed to process {word}/{category_id}: {e}")
                success = False

        if success:
            self.processed_words.add(word)
        else:
            self.failed_words.append(word)

        return success


# Convenience function for simple API calls
def make_api_call(prompt: str, system_prompt: Optional[str] = None) -> Optional[str]:
    """
    Simple wrapper for making a single API call.

    Args:
        prompt: User prompt
        system_prompt: Optional system prompt

    Returns:
        Response text or None
    """
    handler = APIHandler()
    return handler.call_api(prompt, system_prompt)


if __name__ == "__main__":
    # Test the API handler
    logging.basicConfig(level=logging.INFO)

    handler = APIHandler()

    # Test simple call
    response = handler.call_api(
        "צור 3 משפטים פשוטים בעברית עם המילה 'שלום' עבור ילדים עם אוטיזם. החזר כ-JSON."
    )

    if response:
        print("Response received:")
        print(response)
        print("\nStats:", handler.get_stats())
    else:
        print("API call failed")
