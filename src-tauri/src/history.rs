use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const HISTORY_FILENAME: &str = "history.json";
/// Keep the file bounded so it stays fast to load and save.
const MAX_ENTRIES: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryEntry {
    pub id: String,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
}

pub struct HistoryStore {
    path: PathBuf,
    entries: Vec<HistoryEntry>,
    max_entries: usize,
}

impl HistoryStore {
    pub fn load(app_dir: &Path) -> Self {
        let path = app_dir.join(HISTORY_FILENAME);
        let entries = fs::read_to_string(&path)
            .ok()
            .and_then(|contents| serde_json::from_str::<Vec<HistoryEntry>>(&contents).ok())
            .unwrap_or_default();

        Self {
            path,
            entries,
            max_entries: MAX_ENTRIES,
        }
    }

    /// Returns history newest-first.
    pub fn entries(&self) -> Vec<HistoryEntry> {
        self.entries.clone()
    }

    /// Adds a transcription to the top of the history and persists it.
    /// Blank text is ignored.
    pub fn add(&mut self, text: &str) -> Result<Option<HistoryEntry>, String> {
        let text = text.trim();
        if text.is_empty() {
            return Ok(None);
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let created_at = now.as_millis() as u64;
        let entry = HistoryEntry {
            id: format!("{}-{}", created_at, now.subsec_nanos()),
            text: text.to_string(),
            created_at,
        };

        self.entries.insert(0, entry.clone());
        if self.entries.len() > self.max_entries {
            self.entries.truncate(self.max_entries);
        }
        self.save()?;

        Ok(Some(entry))
    }

    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        let previous_len = self.entries.len();
        self.entries.retain(|entry| entry.id != id);

        if self.entries.len() != previous_len {
            self.save()?;
        }

        Ok(())
    }

    pub fn clear(&mut self) -> Result<(), String> {
        if self.entries.is_empty() {
            return Ok(());
        }

        self.entries.clear();
        self.save()
    }

    fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let json = serde_json::to_string_pretty(&self.entries).map_err(|e| e.to_string())?;

        // Write to a temporary file first so a crash mid-write can't corrupt
        // the existing history.
        let temp_path = self.path.with_extension("json.tmp");
        fs::write(&temp_path, &json).map_err(|e| e.to_string())?;

        match fs::rename(&temp_path, &self.path) {
            Ok(()) => Ok(()),
            Err(_) => {
                // Some platforms may refuse to replace an existing file.
                fs::write(&self.path, &json).map_err(|e| e.to_string())?;
                let _ = fs::remove_file(&temp_path);
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    fn temp_history_dir(name: &str) -> PathBuf {
        let dir = temp_dir().join(name);
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn test_add_persists_newest_first() {
        let dir = temp_history_dir("typr_test_history_add");
        let mut store = HistoryStore::load(&dir);

        store.add("First one.").unwrap();
        store.add("Second one.").unwrap();

        let reloaded = HistoryStore::load(&dir);
        let entries = reloaded.entries();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].text, "Second one.");
        assert_eq!(entries[1].text, "First one.");
        assert!(entries[0].created_at >= entries[1].created_at);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_add_ignores_blank_text() {
        let dir = temp_history_dir("typr_test_history_blank");
        let mut store = HistoryStore::load(&dir);

        assert_eq!(store.add("   ").unwrap(), None);
        assert!(store.entries().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_delete_entry() {
        let dir = temp_history_dir("typr_test_history_delete");
        let mut store = HistoryStore::load(&dir);

        let first = store.add("Keep me.").unwrap().unwrap();
        store.add("Delete me.").unwrap();

        store.delete(&first.id).unwrap();

        let reloaded = HistoryStore::load(&dir);
        let entries = reloaded.entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].text, "Delete me.");
        assert!(entries.iter().all(|entry| entry.id != first.id));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_delete_missing_entry_is_noop() {
        let dir = temp_history_dir("typr_test_history_delete_missing");
        let mut store = HistoryStore::load(&dir);
        store.add("Only entry.").unwrap();

        store.delete("does-not-exist").unwrap();
        assert_eq!(store.entries().len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_clear_history() {
        let dir = temp_history_dir("typr_test_history_clear");
        let mut store = HistoryStore::load(&dir);
        store.add("One.").unwrap();
        store.add("Two.").unwrap();

        store.clear().unwrap();

        assert!(store.entries().is_empty());
        assert!(HistoryStore::load(&dir).entries().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_load_missing_file_returns_empty() {
        let dir = temp_history_dir("typr_test_history_missing");
        let store = HistoryStore::load(&dir);
        assert!(store.entries().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_load_corrupt_file_returns_empty() {
        let dir = temp_history_dir("typr_test_history_corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(HISTORY_FILENAME), "not json").unwrap();

        let store = HistoryStore::load(&dir);
        assert!(store.entries().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_entries_are_capped() {
        let dir = temp_history_dir("typr_test_history_capped");
        let mut store = HistoryStore {
            path: dir.join(HISTORY_FILENAME),
            entries: Vec::new(),
            max_entries: 3,
        };

        for index in 0..5 {
            store.add(&format!("Entry {}", index)).unwrap();
        }

        let entries = store.entries();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].text, "Entry 4");
        assert_eq!(entries[2].text, "Entry 2");

        let reloaded = HistoryStore::load(&dir);
        assert_eq!(reloaded.entries().len(), 3);

        let _ = fs::remove_dir_all(&dir);
    }
}
