import unittest
from unittest.mock import MagicMock, patch
import json
import sys
import os

# Add repo root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from jwFetcher import NJUCourseClient

class TestSearchMode(unittest.TestCase):
    def setUp(self):
        with patch('jwFetcher.LoginInterceptor') as MockInterceptor:
            instance = MockInterceptor.return_value
            instance.get_cookie.return_value = "dummy_cookie"
            self.client = NJUCourseClient()

    @patch('requests.post')
    def test_search_mode_or(self, mock_post):
        """Test default OR behavior (nested lists)"""
        mock_response = MagicMock()
        mock_response.json.return_value = {"datas": {"qxfbkccx": {"rows": [], "totalSize": 0}}}
        mock_post.return_value = mock_response

        # Execute search with OR mode (explicit)
        self.client.search(course_name="Math English", match_mode="OR")

        # Verify payload
        args, kwargs = mock_post.call_args
        data = kwargs['data']
        query_setting = json.loads(data['querySetting'])

        # Expect nested list structure
        kcm_group = None
        for item in query_setting:
            if isinstance(item, list) and len(item) > 0 and isinstance(item[0], list):
                inner = item[0]
                if inner and inner[0].get('name') == 'KCM':
                    kcm_group = inner
                    break

        self.assertIsNotNone(kcm_group, "OR mode should produce nested list")
        self.assertEqual(len(kcm_group), 2)
        self.assertEqual(kcm_group[0]['value'], 'Math')
        self.assertEqual(kcm_group[0]['linkOpt'], 'AND') # First link to prev
        self.assertEqual(kcm_group[1]['value'], 'English')
        self.assertEqual(kcm_group[1]['linkOpt'], 'OR') # Internal link

    @patch('requests.post')
    def test_search_mode_and(self, mock_post):
        """Test AND behavior (flat list with multiple entries)"""
        mock_response = MagicMock()
        mock_response.json.return_value = {"datas": {"qxfbkccx": {"rows": [], "totalSize": 0}}}
        mock_post.return_value = mock_response

        # Execute search with AND mode
        self.client.search(course_name="Math English", match_mode="AND")

        # Verify payload
        args, kwargs = mock_post.call_args
        data = kwargs['data']
        query_setting = json.loads(data['querySetting'])

        # Expect multiple flat dictionary entries
        kcm_items = [item for item in query_setting if isinstance(item, dict) and item.get('name') == 'KCM']

        self.assertEqual(len(kcm_items), 2, "AND mode should produce multiple flat entries")

        self.assertEqual(kcm_items[0]['value'], 'Math')
        self.assertEqual(kcm_items[0]['linkOpt'], 'AND')

        self.assertEqual(kcm_items[1]['value'], 'English')
        self.assertEqual(kcm_items[1]['linkOpt'], 'AND')

if __name__ == '__main__':
    unittest.main()
