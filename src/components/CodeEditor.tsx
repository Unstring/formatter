import { useState, useEffect, useCallback, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import * as prettier from "prettier/standalone";
import * as parserBabel from "prettier/parser-babel";
import * as parserHtml from "prettier/parser-html";
import * as parserPostcss from "prettier/parser-postcss";

// Constants and Type Definitions
const DB_NAME = "codeEditorDB";
const FILES_STORE = "files";
const META_STORE = "fileMeta";
const DB_VERSION = 2;
// const DEBOUNCE_DELAY = 500;
const DEFAULT_FILE_NAME = "index.js";

type File = {
  id: string;
  name: string;
  content: string;
  language: string;
  position?: number;
  tabIndex?: number;
  lastActive?: boolean;
};

type FileMeta = {
  id: "fileMeta";
  activeFileId: string;
  history: string[];  // Array of file IDs in order of access
  fileOrder: string[];
};

const LANGUAGE_MAP: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  html: "html",
  css: "css",
  json: "json",
};

const PRETTIER_PARSER_MAP: Record<string, string> = {
  js: "babel",
  ts: "typescript",
  html: "html",
  css: "css",
  json: "json",
};

// Database Service
const initializeDB = () => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: "id" });
      }
      
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const loadMetaFromDB = async (db: IDBDatabase): Promise<FileMeta | null> => {
  const transaction = db.transaction(META_STORE, "readonly");
  const store = transaction.objectStore(META_STORE);
  const request = store.get("fileMeta");

  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

const saveMetaToDB = async (db: IDBDatabase, meta: FileMeta): Promise<void> => {
  const transaction = db.transaction(META_STORE, "readwrite");
  const store = transaction.objectStore(META_STORE);
  
  return new Promise((resolve, reject) => {
    const request = store.put(meta);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const loadFilesFromDB = async (db: IDBDatabase, fileOrder: string[] = []) => {
  const transaction = db.transaction(FILES_STORE, "readonly");
  const store = transaction.objectStore(FILES_STORE);
  const request = store.getAll();

  return new Promise<File[]>((resolve, reject) => {
    request.onsuccess = () => {
      const files = request.result;
      if (fileOrder.length) {
        files.sort((a, b) => {
          const aIndex = fileOrder.indexOf(a.id);
          const bIndex = fileOrder.indexOf(b.id);
          return aIndex - bIndex;
        });
      }
      resolve(files);
    };
    request.onerror = () => reject(request.error);
  });
};

// First, move the saveFileToDB function outside the component
const saveFileToDB = async (db: IDBDatabase, fileToSave: File) => {
  const transaction = db.transaction(FILES_STORE, "readwrite");
  const store = transaction.objectStore(FILES_STORE);
  
  return new Promise<void>((resolve, reject) => {
    const request = store.put(fileToSave);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Main Component
export default function CodeEditor() {
  const [files, setFiles] = useState<File[]>([]);
  const [activeFileId, setActiveFileId] = useState("");
  const [db, setDb] = useState<IDBDatabase | null>(null);
  const debounceTimer = useRef<number>();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  // Derived state
  const activeFile = files.find((file) => file.id === activeFileId);
  const getFileExtension = (fileName: string) =>
    fileName.split(".").pop()?.toLowerCase() || "js";

  // Move handleEditorChange before formatCode
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      console.log('Editor content changed:', value?.substring(0, 50) + '...');
      if (!activeFile || value === undefined) return;
      
      setFiles((prev) => {
        console.log('Updating files with new content');
        return prev.map((file) => 
          file.id === activeFileId 
            ? { ...file, content: value }
            : file
        );
      });
    },
    [activeFileId, activeFile]
  );

  const saveFile = useCallback(async (file: File) => {
    if (!db) return;
    await saveFileToDB(db, file);
  }, [db]);

  // Now formatCode can use handleEditorChange
  const formatCode = useCallback(async () => {
    if (!activeFile) return;

    try {
      const formatted = await prettier.format(activeFile.content, {
        parser: PRETTIER_PARSER_MAP[getFileExtension(activeFile.name)] || "babel",
        plugins: [parserBabel, parserHtml, parserPostcss],
        semi: true,
        singleQuote: true,
        jsxBracketSameLine: false,
      });

      handleEditorChange(formatted);
    } catch (error) {
      console.error("Formatting error:", error);
      alert("Error formatting code. Check console for details.");
    }
  }, [activeFile, handleEditorChange, getFileExtension]);

  // Update the initialization effect
  useEffect(() => {
    let mounted = true;

    const initializeEditor = async () => {
      try {
        console.log('Initializing editor');
        const database = await initializeDB();
        
        if (!mounted) return;

        // Load metadata first
        const meta = await loadMetaFromDB(database);
        console.log('Loaded metadata:', meta);
        
        // Load files with order from metadata
        const savedFiles = await loadFilesFromDB(database, meta?.fileOrder);
        console.log('Loaded files from DB:', savedFiles);
        
        if (!mounted) return;

        if (savedFiles.length > 0) {
          setFiles(savedFiles);
          // Use metadata for active file if available
          if (meta?.activeFileId && savedFiles.find(f => f.id === meta.activeFileId)) {
            setActiveFileId(meta.activeFileId);
          } else {
            setActiveFileId(savedFiles[0].id);
          }
        } else {
          const newFile = createNewFile(DEFAULT_FILE_NAME);
          setFiles([newFile]);
          setActiveFileId(newFile.id);
          await saveFileToDB(database, newFile);
          // Initialize metadata with history
          await saveMetaToDB(database, {
            id: "fileMeta",
            activeFileId: newFile.id,
            history: [newFile.id],
            fileOrder: [newFile.id],
          });
        }
        
        if (mounted) {
          setDb(database);
        }
      } catch (error) {
        console.error("Initialization error:", error);
        if (mounted) {
          alert("Failed to initialize editor. Check console for details.");
        }
      }
    };

    initializeEditor();

    return () => {
      mounted = false;
    };
  }, []);

  // Update the logging effects
  useEffect(() => {
    console.log('Active file changed:', activeFileId);
  }, [activeFileId]);

  // Remove the files logging effect as it's causing extra renders

  // Update other functions to use the new saveFile
  const addNewFile = useCallback(
    async (fileName: string) => {
      if (files.some((f) => f.id === fileName)) {
        alert("File name already exists!");
        return;
      }

      const newFile = createNewFile(fileName);
      setFiles(prev => [...prev, newFile]);
      setActiveFileId(fileName);
      await saveFile(newFile);
    },
    [files, saveFile]
  );

  const debounceSave = useCallback(
    (content: string) => {
      if (!activeFile) return;

      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = window.setTimeout(() => {
        const fileToSave = { 
          ...activeFile, 
          content,
          lastActive: true
        };
        saveFile(fileToSave);
      }, 1000);
    },
    [activeFile, saveFile]
  );

  // Update the handleTabClick function
  const handleTabClick = useCallback(async (fileId: string) => {
    console.log('Tab clicked:', fileId);
    if (fileId === activeFileId) return;

    try {
      // First load the file content from DB
      if (db) {
        const transaction = db.transaction(FILES_STORE, "readonly");
        const store = transaction.objectStore(FILES_STORE);
        const request = store.get(fileId);
        
        const file = await new Promise<File>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        // Update the files state with fresh content
        setFiles(prev => prev.map(f => 
          f.id === fileId ? file : f
        ));

        // Update active file and history
        setActiveFileId(fileId);

        // Get current metadata
        const currentMeta = await loadMetaFromDB(db);
        const newHistory = currentMeta?.history || [];
        
        // Remove fileId if it exists in history
        const historyIndex = newHistory.indexOf(fileId);
        if (historyIndex !== -1) {
          newHistory.splice(historyIndex, 1);
        }
        // Add fileId to the end of history
        newHistory.push(fileId);
        
        // Keep only the last N entries (where N is the number of files)
        while (newHistory.length > files.length) {
          newHistory.shift();
        }

        // Save updated metadata
        await saveMetaToDB(db, {
          id: "fileMeta",
          activeFileId: fileId,
          history: newHistory,
          fileOrder: files.map(f => f.id),
        });

        // Update editor content
        if (editorRef.current) {
          const model = editorRef.current.getModel();
          if (model) {
            console.log('Setting editor content:', file.content);
            model.setValue(file.content);
          }
        }
      }
    } catch (error) {
      console.error('Error switching tabs:', error);
      alert('Failed to switch tabs. Check console for details.');
    }
  }, [files, activeFileId, db]);

  // Update the drop handler to save new order
  const handleTabDrop = useCallback(async (fromIndex: number, toIndex: number) => {
    const newFiles = [...files];
    const [movedFile] = newFiles.splice(fromIndex, 1);
    newFiles.splice(toIndex, 0, movedFile);
    
    setFiles(newFiles);
    
    // Save new order to metadata
    if (db) {
      await saveMetaToDB(db, {
        id: "fileMeta",
        activeFileId,
        fileOrder: newFiles.map(f => f.id),
        history: []
      });
    }
  }, [files, db, activeFileId]);

  // File Operations
  const createNewFile = (fileName: string): File => {
    const extension = getFileExtension(fileName);
    return {
      id: fileName,
      name: fileName,
      content: "",
      language: LANGUAGE_MAP[extension] || "javascript",
    };
  };

  // Update deleteFile function
  const deleteFile = useCallback(async (fileId: string) => {
    console.log('Deleting file:', fileId);
    if (files.length <= 1) {
      alert("You need at least one file!");
      return;
    }

    if (!db) return;

    try {
      // Get current metadata
      const meta = await loadMetaFromDB(db);
      // Get history without the file being deleted
      const history = meta?.history.filter(id => id !== fileId) || [];
      const updatedFiles = files.filter(f => f.id !== fileId);

      // If deleting active file
      if (activeFileId === fileId) {
        // Get the previous file from history (second last entry, since last is current)
        const previousFileId = history[history.length - 2] || history[history.length - 1] || updatedFiles[0].id;
        console.log('Switching to previous file:', previousFileId);
        
        // Switch to the previous file
        const transaction = db.transaction(FILES_STORE, "readonly");
        const store = transaction.objectStore(FILES_STORE);
        const request = store.get(previousFileId);
        
        const previousFile = await new Promise<File>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        // Update states
        setActiveFileId(previousFileId);
        setFiles(updatedFiles);

        // Update editor content
        if (editorRef.current) {
          const model = editorRef.current.getModel();
          if (model) {
            console.log('Setting editor content to previous file:', previousFile.content);
            model.setValue(previousFile.content);
          }
        }

        // Update metadata
        await saveMetaToDB(db, {
          id: "fileMeta",
          activeFileId: previousFileId,
          history: history.filter(id => id !== previousFileId).concat([previousFileId]), // Move previous to end
          fileOrder: updatedFiles.map(f => f.id),
        });
      } else {
        // Just deleting an inactive file
        setFiles(updatedFiles);
        await saveMetaToDB(db, {
          id: "fileMeta",
          activeFileId,
          history,
          fileOrder: updatedFiles.map(f => f.id),
        });
      }

      // Delete the file from DB
      const deleteTransaction = db.transaction(FILES_STORE, "readwrite");
      const deleteStore = deleteTransaction.objectStore(FILES_STORE);
      await deleteStore.delete(fileId);

    } catch (error) {
      console.error("Error deleting file:", error);
      alert("Failed to delete file");
    }
  }, [files, activeFileId, db]);

  return (
    <div className="editor-container">
      <div className="tabs-container">
        <div className="tabs">
          {files.map((file, index) => (
            <div
              key={file.id}
              className="tab-container"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(index));
              }}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromIndex = Number(e.dataTransfer.getData('text/plain'));
                const toIndex = index;
                handleTabDrop(fromIndex, toIndex);
              }}
            >
              <button
                onClick={() => handleTabClick(file.id)}
                className={`tab ${activeFileId === file.id ? "active" : ""}`}
              >
                {file.name}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteFile(file.id);
                }}
                className="delete-button"
                disabled={files.length <= 1}
                aria-label={`Delete ${file.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        
        <div className="controls">
          <button
            onClick={() => {
              const name = prompt("Enter file name with extension:");
              name && addNewFile(name);
            }}
            className="add-file"
            aria-label="Add new file"
          >
            + New File
          </button>
          <button 
            onClick={formatCode}
            className="format-button"
            aria-label="Format code"
          >
            Format Code
          </button>
        </div>
      </div>

      {activeFile && (
        <Editor
          key={activeFileId}
          height="calc(100vh - 75px)"
          language={activeFile.language}
          defaultValue={activeFile.content}
          theme="myTheme"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            automaticLayout: true,
            contextmenu: false,
            formatOnPaste: true,
            formatOnType: true,
            overviewRulerLanes: 0,
            scrollbar: {
              vertical: "hidden",
              horizontal: "hidden",
              handleMouseWheel: false,
            },
            wordWrap: 'on',
          }}
          onChange={(value) => {
            handleEditorChange(value);
            if (value) {
              debounceSave(value);
            }
          }}
          onMount={(editor) => {
            editorRef.current = editor;
          }}
          beforeMount={(monaco) => {
            monaco.editor.defineTheme("myTheme", {
              base: "vs-dark",
              inherit: true,
              rules: [],
              colors: {
                "editor.background": "#000000",
                "editor.foreground": "#FFFFFF",
              },
            });
          }}
        />
      )}
    </div>
  );
}