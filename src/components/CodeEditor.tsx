import { useState, useEffect, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import * as prettier from "prettier/standalone";
import * as parserBabel from "prettier/parser-babel";
import * as parserHtml from "prettier/parser-html";
import * as parserPostcss from "prettier/parser-postcss";

// Constants and Type Definitions
const DB_NAME = "codeEditorDB";
const STORE_NAME = "files";
const DB_VERSION = 1;
const DEBOUNCE_DELAY = 500;
const DEFAULT_FILE_NAME = "index.js";

type File = {
  id: string;
  name: string;
  content: string;
  language: string;
  position?: number;
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const loadFilesFromDB = async (db: IDBDatabase) => {
  const transaction = db.transaction(STORE_NAME, "readonly");
  const store = transaction.objectStore(STORE_NAME);
  const request = store.getAll();

  return new Promise<File[]>((resolve, reject) => {
    request.onsuccess = () => {
      const files = request.result;
      // Sort files by tabIndex if available
      files.sort((a, b) => (a.tabIndex || 0) - (b.tabIndex || 0));
      resolve(files);
    };
    request.onerror = () => reject(request.error);
  });
};

// Main Component
export default function CodeEditor() {
  const [files, setFiles] = useState<File[]>([]);
  const [activeFileId, setActiveFileId] = useState("");
  const [db, setDb] = useState<IDBDatabase | null>(null);
  const debounceTimer = useRef<number>();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const isUserChange = useRef(false);

  // Derived state
  const activeFile = files.find((file) => file.id === activeFileId);
  const getFileExtension = (fileName: string) =>
    fileName.split(".").pop()?.toLowerCase() || "js";

  // Database Operations
  const saveFileToDB = useCallback(
    async (fileToSave: File) => {
      if (!db) return;
      
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      
      return new Promise<void>((resolve, reject) => {
        const request = store.put(fileToSave);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },
    [db]
  );

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

  const addNewFile = useCallback(
    async (fileName: string) => {
      if (files.some((f) => f.id === fileName)) {
        alert("File name already exists!");
        return;
      }

      const newFile = createNewFile(fileName);
      const updatedFiles = [...files, newFile];
      
      setFiles(updatedFiles);
      setActiveFileId(fileName);
      await saveFileToDB(newFile); // Save only the new file
    },
    [files, saveFileToDB]
  );

  const deleteFile = useCallback(
    async (fileId: string) => {
      if (files.length <= 1) {
        alert("You need at least one file!");
        return;
      }

      if (!db) return;

      try {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        await store.delete(fileId);

        const updatedFiles = files.filter((f) => f.id !== fileId);
        setFiles(updatedFiles);
        
        if (activeFileId === fileId) {
          const nextFile = updatedFiles[0];
          if (nextFile) {
            setActiveFileId(nextFile.id);
          }
        }
      } catch (error) {
        console.error("Error deleting file:", error);
        alert("Failed to delete file");
      }
    },
    [files, activeFileId, db]
  );

  // Editor Operations
  const handleEditorChange = useCallback(
    (content: string) => {
      if (!activeFile || !editorRef.current) return;

      const updatedFile: File = { 
        ...activeFile, 
        content,
        position: editorRef.current.getPosition()?.lineNumber || 0
      };
      
      setFiles((prev) =>
        prev.map((file) => (file.id === activeFileId ? updatedFile : file))
      );

      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = window.setTimeout(() => {
        saveFileToDB(updatedFile);
      }, DEBOUNCE_DELAY);
    },
    [activeFile, activeFileId, saveFileToDB]
  );

  // Formatting
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
  }, [activeFile, handleEditorChange]);

  // Initialization
  useEffect(() => {
    const initializeEditor = async () => {
      try {
        const database = await initializeDB();
        const savedFiles = await loadFilesFromDB(database);
        
        if (savedFiles.length > 0) {
          setFiles(savedFiles);
          setActiveFileId(savedFiles[0].id);
        } else {
          const newFile = createNewFile(DEFAULT_FILE_NAME);
          setFiles([newFile]);
          setActiveFileId(newFile.id);
          await saveFileToDB(newFile);
        }
        
        setDb(database);
      } catch (error) {
        console.error("Initialization error:", error);
        alert("Failed to initialize editor. Check console for details.");
      }
    };

    initializeEditor();
  }, [saveFileToDB]);

  // Add this function to save tab order
  const saveTabOrder = useCallback(async () => {
    if (!db) return;
    
    const updatedFiles = files.map((file, index) => ({
      ...file,
      tabIndex: index
    }));
    
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    
    for (const file of updatedFiles) {
      await store.put(file);
    }
  }, [files, db]);

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
                
                const newFiles = [...files];
                const [movedFile] = newFiles.splice(fromIndex, 1);
                newFiles.splice(toIndex, 0, movedFile);
                
                setFiles(newFiles);
                saveTabOrder();
              }}
            >
              <button
                onClick={() => setActiveFileId(file.id)}
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
          height="calc(100vh - 70px)"
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
          }}
          onChange={(value) => {
            if (value !== undefined) {
              handleEditorChange(value);
            }
          }}
          onMount={(editor) => {
            editorRef.current = editor;
            
            // Restore cursor position if available
            if (activeFile.position) {
              editor.setPosition({ 
                lineNumber: activeFile.position, 
                column: 1 
              });
              editor.revealLineInCenter(activeFile.position);
            }
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