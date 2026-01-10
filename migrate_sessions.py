import os
import json
import glob
from jwFetcher import ScheduleBitmapper

SESSION_DIR = "saved_sessions"

def migrate():
    if not os.path.exists(SESSION_DIR):
        print(f"Directory {SESSION_DIR} does not exist. Nothing to migrate.")
        return

    files = glob.glob(os.path.join(SESSION_DIR, "*.json"))
    print(f"Found {len(files)} session files.")

    for filepath in files:
        print(f"Processing {filepath}...")
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)

            groups = data.get("groups", [])
            modified_count = 0

            for group in groups:
                candidates = group.get("candidates", [])
                for cand in candidates:
                    loc = cand.get("location_text", "")
                    # Re-generate bitmap
                    new_bitmap = ScheduleBitmapper.generate_bitmap(loc)
                    cand["schedule_bitmaps"] = new_bitmap
                    modified_count += 1

            # Save back
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            print(f"  -> Updated {modified_count} candidates.")

        except Exception as e:
            print(f"  -> Error processing {filepath}: {e}")

if __name__ == "__main__":
    migrate()
