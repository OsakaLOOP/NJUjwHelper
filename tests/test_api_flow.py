import unittest
from unittest.mock import MagicMock, patch
from main import Api

class TestApiFlow(unittest.TestCase):
    def setUp(self):
        # Mock the NJUCourseClient to avoid network calls and GUI
        with patch('main.NJUCourseClient') as MockClient:
            self.mock_client_instance = MockClient.return_value
            self.api = Api()

    def test_search_flow(self):
        # Setup mock return
        self.mock_client_instance.search.return_value = [{'name': 'Math', 'code': '001'}]

        # Test Search
        res = self.api.search({'name': 'Math', 'semester': '2025-2026-1'})
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]['name'], 'Math')

        # Verify passed arguments
        self.mock_client_instance.search.assert_called_with(
            course_name='Math',
            course_code=None,
            campus='1',
            semester='2025-2026-1'
        )

    def test_generate_flow(self):
        # Dummy groups
        groups = [{
            'id': 1,
            'candidates': [{'name': 'A', 'schedule_bitmaps': [0, 3], 'selected': True}],
        }]
        prefs = {'avoid_early_morning': False}

        # Test Generate
        res = self.api.generate_schedules(groups, prefs)
        self.assertIn('schedules', res)
        self.assertEqual(len(res['schedules']), 1)
        self.assertEqual(res['schedules'][0]['score'], 100.0) # No conflicts, no prefs

    def test_save_flow(self):
        # Test Save
        groups_json = '[{"id": 1}]'
        prefs_json = '{}'

        # Mock session manager save to avoid file I/O if possible, or just let it run (it writes to saved_sessions)
        with patch.object(self.api.session_manager, 'save_session', return_value='path/to/file') as mock_save:
            res = self.api.save_session(groups_json, prefs_json)
            self.assertTrue(res)
            mock_save.assert_called_once()

if __name__ == "__main__":
    unittest.main()
