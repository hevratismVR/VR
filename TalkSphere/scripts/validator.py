#!/usr/bin/env python3
"""
TalkSphere - JSON Content Validator
Validates generated JSON files for structure, content, and completeness.
"""

import json
import re
import logging
from pathlib import Path
from typing import Dict, List, Tuple, Any, Optional
from dataclasses import dataclass, field

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class ValidationResult:
    """Result of a validation check."""
    is_valid: bool
    file_path: str
    category: str
    word: str
    total_items: int = 0
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ValidationConfig:
    """Configuration for validation thresholds."""
    min_items_per_category: int = 1800  # Minimum acceptable items
    target_items_per_category: int = 2000  # Target items
    min_hebrew_ratio: float = 0.3  # Minimum ratio of Hebrew characters
    max_duplicate_ratio: float = 0.1  # Maximum allowed duplicates
    required_metadata_fields: List[str] = field(default_factory=lambda: [
        'word', 'word_id', 'category'
    ])


class ContentValidator:
    """Validates TalkSphere generated content."""

    # Hebrew character range
    HEBREW_PATTERN = re.compile(r'[\u0590-\u05FF]')

    def __init__(self, config: Optional[ValidationConfig] = None):
        """
        Initialize validator with configuration.

        Args:
            config: Validation configuration. Uses defaults if None.
        """
        self.config = config or ValidationConfig()
        self.templates = None

    def load_templates(self, templates_path: str):
        """Load category templates for validation reference."""
        with open(templates_path, 'r', encoding='utf-8') as f:
            self.templates = json.load(f)

    def _count_items(self, data: Dict[str, Any]) -> int:
        """Count total items in a JSON structure."""
        total = 0
        for key, value in data.items():
            if isinstance(value, list):
                total += len(value)
            elif isinstance(value, dict):
                total += self._count_items(value)
        return total

    def _count_hebrew_chars(self, text: str) -> int:
        """Count Hebrew characters in text."""
        return len(self.HEBREW_PATTERN.findall(text))

    def _get_all_text(self, data: Any) -> str:
        """Extract all text content from nested structure."""
        if isinstance(data, str):
            return data
        elif isinstance(data, list):
            return ' '.join(self._get_all_text(item) for item in data)
        elif isinstance(data, dict):
            return ' '.join(self._get_all_text(v) for v in data.values())
        return ''

    def _find_duplicates(self, data: Dict[str, Any]) -> List[Tuple[str, List[str]]]:
        """Find duplicate items in arrays."""
        duplicates = []
        for key, value in data.items():
            if isinstance(value, list):
                seen = {}
                for i, item in enumerate(value):
                    item_str = json.dumps(item, ensure_ascii=False) if not isinstance(item, str) else item
                    if item_str in seen:
                        if key not in [d[0] for d in duplicates]:
                            duplicates.append((key, []))
                        for d in duplicates:
                            if d[0] == key:
                                d[1].append(item_str[:50])
                    seen[item_str] = i
        return duplicates

    def validate_json_structure(self, file_path: str) -> ValidationResult:
        """
        Validate basic JSON structure and integrity.

        Args:
            file_path: Path to JSON file

        Returns:
            ValidationResult with structure validation details
        """
        path = Path(file_path)
        result = ValidationResult(
            is_valid=True,
            file_path=str(path),
            category=path.stem,
            word="unknown"
        )

        # Check file exists
        if not path.exists():
            result.is_valid = False
            result.errors.append(f"File not found: {file_path}")
            return result

        # Try to load JSON
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            result.is_valid = False
            result.errors.append(f"Invalid JSON: {e}")
            return result
        except Exception as e:
            result.is_valid = False
            result.errors.append(f"Error reading file: {e}")
            return result

        # Extract word info
        result.word = data.get('word', 'unknown')

        # Count items
        result.total_items = self._count_items(data)
        result.details['total_items'] = result.total_items

        # Check minimum items
        if result.total_items < self.config.min_items_per_category:
            result.warnings.append(
                f"Below minimum items: {result.total_items} < {self.config.min_items_per_category}"
            )

        # Check required metadata fields
        missing_fields = []
        for field in self.config.required_metadata_fields:
            if field not in data:
                missing_fields.append(field)

        if missing_fields:
            result.errors.append(f"Missing required fields: {missing_fields}")
            result.is_valid = False

        return result

    def validate_hebrew_content(self, file_path: str) -> ValidationResult:
        """
        Validate that content contains sufficient Hebrew text.

        Args:
            file_path: Path to JSON file

        Returns:
            ValidationResult with Hebrew content validation details
        """
        path = Path(file_path)
        result = ValidationResult(
            is_valid=True,
            file_path=str(path),
            category=path.stem,
            word="unknown"
        )

        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            result.is_valid = False
            result.errors.append(f"Error loading file: {e}")
            return result

        result.word = data.get('word', 'unknown')

        # Get all text content
        all_text = self._get_all_text(data)
        total_chars = len(all_text)
        hebrew_chars = self._count_hebrew_chars(all_text)

        if total_chars > 0:
            hebrew_ratio = hebrew_chars / total_chars
            result.details['hebrew_ratio'] = round(hebrew_ratio, 3)
            result.details['total_characters'] = total_chars
            result.details['hebrew_characters'] = hebrew_chars

            if hebrew_ratio < self.config.min_hebrew_ratio:
                result.warnings.append(
                    f"Low Hebrew content ratio: {hebrew_ratio:.1%} < {self.config.min_hebrew_ratio:.1%}"
                )
        else:
            result.errors.append("No text content found")
            result.is_valid = False

        return result

    def validate_duplicates(self, file_path: str) -> ValidationResult:
        """
        Check for duplicate content in arrays.

        Args:
            file_path: Path to JSON file

        Returns:
            ValidationResult with duplicate validation details
        """
        path = Path(file_path)
        result = ValidationResult(
            is_valid=True,
            file_path=str(path),
            category=path.stem,
            word="unknown"
        )

        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            result.is_valid = False
            result.errors.append(f"Error loading file: {e}")
            return result

        result.word = data.get('word', 'unknown')

        duplicates = self._find_duplicates(data)
        if duplicates:
            result.details['duplicate_fields'] = [d[0] for d in duplicates]
            total_items = self._count_items(data)
            duplicate_count = sum(len(d[1]) for d in duplicates)

            if total_items > 0:
                duplicate_ratio = duplicate_count / total_items
                result.details['duplicate_ratio'] = round(duplicate_ratio, 3)

                if duplicate_ratio > self.config.max_duplicate_ratio:
                    result.warnings.append(
                        f"High duplicate ratio: {duplicate_ratio:.1%} in fields: {[d[0] for d in duplicates]}"
                    )

        return result

    def validate_category_structure(self, file_path: str, category_id: str) -> ValidationResult:
        """
        Validate content matches expected category structure.

        Args:
            file_path: Path to JSON file
            category_id: Category ID to validate against

        Returns:
            ValidationResult with category structure validation details
        """
        path = Path(file_path)
        result = ValidationResult(
            is_valid=True,
            file_path=str(path),
            category=category_id,
            word="unknown"
        )

        if not self.templates:
            result.warnings.append("Templates not loaded - skipping structure validation")
            return result

        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            result.is_valid = False
            result.errors.append(f"Error loading file: {e}")
            return result

        result.word = data.get('word', 'unknown')

        # Find category template
        category_template = None
        for cat in self.templates['categories']:
            if cat['id'] == category_id:
                category_template = cat
                break

        if not category_template:
            result.warnings.append(f"Unknown category: {category_id}")
            return result

        # Check expected structure fields
        expected_fields = list(category_template['structure'].keys())
        present_fields = [k for k in data.keys() if k not in ['word', 'word_id', 'word_nikud', 'category', 'generated_batches']]

        missing = set(expected_fields) - set(present_fields)
        extra = set(present_fields) - set(expected_fields)

        if missing:
            result.warnings.append(f"Missing expected fields: {list(missing)}")
            result.details['missing_fields'] = list(missing)

        if extra:
            result.details['extra_fields'] = list(extra)

        # Check target items
        result.total_items = self._count_items(data)
        if result.total_items < category_template['target_items'] * 0.9:  # 90% threshold
            result.warnings.append(
                f"Below target items: {result.total_items} < {category_template['target_items']}"
            )

        return result

    def validate_file(self, file_path: str) -> ValidationResult:
        """
        Run all validations on a single file.

        Args:
            file_path: Path to JSON file

        Returns:
            Combined ValidationResult
        """
        path = Path(file_path)

        # Run all validations
        structure_result = self.validate_json_structure(file_path)
        if not structure_result.is_valid:
            return structure_result

        hebrew_result = self.validate_hebrew_content(file_path)
        duplicates_result = self.validate_duplicates(file_path)

        # Determine category from filename
        category_id = path.stem  # e.g., "01_basic"
        category_result = self.validate_category_structure(file_path, category_id)

        # Combine results
        combined = ValidationResult(
            is_valid=structure_result.is_valid and hebrew_result.is_valid,
            file_path=str(path),
            category=category_id,
            word=structure_result.word,
            total_items=structure_result.total_items
        )

        # Merge all errors and warnings
        combined.errors.extend(structure_result.errors)
        combined.errors.extend(hebrew_result.errors)
        combined.errors.extend(duplicates_result.errors)
        combined.errors.extend(category_result.errors)

        combined.warnings.extend(structure_result.warnings)
        combined.warnings.extend(hebrew_result.warnings)
        combined.warnings.extend(duplicates_result.warnings)
        combined.warnings.extend(category_result.warnings)

        # Merge details
        combined.details.update(structure_result.details)
        combined.details.update(hebrew_result.details)
        combined.details.update(duplicates_result.details)
        combined.details.update(category_result.details)

        return combined

    def validate_word_folder(self, folder_path: str) -> List[ValidationResult]:
        """
        Validate all JSON files in a word folder.

        Args:
            folder_path: Path to word folder

        Returns:
            List of ValidationResults for each file
        """
        path = Path(folder_path)
        results = []

        if not path.is_dir():
            logger.error(f"Not a directory: {folder_path}")
            return results

        json_files = sorted(path.glob("*.json"))

        for json_file in json_files:
            result = self.validate_file(str(json_file))
            results.append(result)

            status = "✓" if result.is_valid and not result.warnings else "⚠" if result.warnings else "✗"
            logger.info(f"{status} {json_file.name}: {result.total_items} items")

            if result.errors:
                for error in result.errors:
                    logger.error(f"  Error: {error}")
            if result.warnings:
                for warning in result.warnings:
                    logger.warning(f"  Warning: {warning}")

        return results

    def generate_report(self, results: List[ValidationResult]) -> Dict[str, Any]:
        """
        Generate a summary report from validation results.

        Args:
            results: List of ValidationResults

        Returns:
            Summary report dictionary
        """
        report = {
            "total_files": len(results),
            "valid_files": sum(1 for r in results if r.is_valid),
            "files_with_warnings": sum(1 for r in results if r.warnings),
            "files_with_errors": sum(1 for r in results if not r.is_valid),
            "total_items": sum(r.total_items for r in results),
            "average_items": sum(r.total_items for r in results) / len(results) if results else 0,
            "errors": [],
            "warnings": [],
            "by_category": {}
        }

        for result in results:
            # Track by category
            if result.category not in report["by_category"]:
                report["by_category"][result.category] = {
                    "valid": 0,
                    "invalid": 0,
                    "total_items": 0
                }

            if result.is_valid:
                report["by_category"][result.category]["valid"] += 1
            else:
                report["by_category"][result.category]["invalid"] += 1

            report["by_category"][result.category]["total_items"] += result.total_items

            # Collect errors and warnings
            for error in result.errors:
                report["errors"].append({
                    "file": result.file_path,
                    "word": result.word,
                    "category": result.category,
                    "error": error
                })

            for warning in result.warnings:
                report["warnings"].append({
                    "file": result.file_path,
                    "word": result.word,
                    "category": result.category,
                    "warning": warning
                })

        return report


def validate_output_directory(output_dir: str, templates_path: str) -> Dict[str, Any]:
    """
    Validate all generated content in output directory.

    Args:
        output_dir: Path to output/words directory
        templates_path: Path to category templates

    Returns:
        Full validation report
    """
    validator = ContentValidator()
    validator.load_templates(templates_path)

    output_path = Path(output_dir)
    all_results = []

    word_folders = sorted([d for d in output_path.iterdir() if d.is_dir()])

    for folder in word_folders:
        logger.info(f"\n{'='*50}")
        logger.info(f"Validating: {folder.name}")
        logger.info(f"{'='*50}")

        results = validator.validate_word_folder(str(folder))
        all_results.extend(results)

    report = validator.generate_report(all_results)

    # Print summary
    logger.info(f"\n{'='*50}")
    logger.info("VALIDATION SUMMARY")
    logger.info(f"{'='*50}")
    logger.info(f"Total files: {report['total_files']}")
    logger.info(f"Valid files: {report['valid_files']}")
    logger.info(f"Files with warnings: {report['files_with_warnings']}")
    logger.info(f"Files with errors: {report['files_with_errors']}")
    logger.info(f"Total items: {report['total_items']:,}")
    logger.info(f"Average items per file: {report['average_items']:.0f}")

    return report


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python validator.py <output_dir> [templates_path]")
        print("Example: python validator.py ../output/words ../templates/category_templates.json")
        sys.exit(1)

    output_dir = sys.argv[1]
    templates_path = sys.argv[2] if len(sys.argv) > 2 else "../templates/category_templates.json"

    report = validate_output_directory(output_dir, templates_path)

    # Save report
    report_path = Path(output_dir).parent / "validation_report.json"
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\nReport saved to: {report_path}")
