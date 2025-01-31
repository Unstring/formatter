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

type File = {
  id: string;
  name: string;
  content: string;
  language: string;
};

const languageMap: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  html: "html",
  css: "css",
  json: "json",
};

const prettierParserMap: Record<string, string> = {
  js: "babel",
  ts: "typescript",
  html: "html",
  css: "css",
  json: "json",
};

// Main Component
export default function CodeEditor() {
  const [files, setFiles] = useState<File[]>([]);
  const [activeFileId, setActiveFileId] = useState("");
  const [db, setDb] = useState<IDBDatabase | null>(null);
  const debounceTimer = useRef<number>();

  // File Management
  const activeFile = files.find(file => file.id === activeFileId);
  const getFileExtension = (fileName: string) => fileName.split('.').pop()?.toLowerCase() || 'js';

  // Database Operations
  const saveFilesToDB = useCallback((filesToSave: File[]) => {
    if (!db) return;
    
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    filesToSave.forEach(file => store.put(file));
    console.log("Files saved to DB");
  }, [db]);

  // File Operations
  const addNewFile = useCallback((fileName: string) => {
    if (files.some(f => f.id === fileName)) {
      alert("File name already exists!");
      return;
    }

    const extension = getFileExtension(fileName);
    const newFile: File = {
      id: fileName,
      name: fileName,
      content: "",
      language: languageMap[extension] || "javascript",
    };

    setFiles(prev => {
      const updated = [...prev, newFile];
      saveFilesToDB(updated);
      console.log("New File saved to DB");
      return updated;
    });
    setActiveFileId(fileName);
  }, [files, saveFilesToDB]);

  const handleDeleteFile = useCallback((fileId: string) => {
    if (files.length <= 1) {
      alert("You need at least one file!");
      return;
    }

    setFiles(prev => {
      const updated = prev.filter(f => f.id !== fileId);
      saveFilesToDB(updated);
      console.log("File Deleted from DB");
      return updated;
    });

    if (activeFileId === fileId) {
      setActiveFileId(files[0].id);
    }
  }, [files, activeFileId, saveFilesToDB]);

  // Editor Handlers
  const handleEditorChange = useCallback((content?: string) => {
    const newContent = content || "";
    
    setFiles(prev => {
      const updated = prev.map(file => 
        file.id === activeFileId ? { ...file, content: newContent } : file
      );
      
      // Debounce DB save
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = window.setTimeout(() => saveFilesToDB(updated),0);
      
      return updated;
    });
  }, [activeFileId, saveFilesToDB]);

  // Formatting
  const handleFormatClick = async () => {
    if (!activeFile) return;

    try {
      const formatted = await prettier.format(activeFile.content, {
        parser: prettierParserMap[getFileExtension(activeFile.name)] || "babel",
        plugins: [parserBabel, parserHtml, parserPostcss],
        semi: true,
        singleQuote: true,
        jsxBracketSameLine: false,
      });

      handleEditorChange(formatted);
      console.log("File formatted");
    } catch (error) {
      console.error("Formatting error:", error);
    }
  };

  // Initialization
  useEffect(() => {
    const openDB = window.indexedDB.open(DB_NAME, DB_VERSION);

    openDB.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    openDB.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const savedFiles = request.result;
        if (savedFiles.length > 0) {
          setFiles(savedFiles);
          setActiveFileId(savedFiles[0].id);
        } else {
          addNewFile("index.js");
        }
        setDb(db);
      };
    };
  }, [addNewFile]);

  return (
    <div className="editor-container">
      <div className="tabs-container">
        <div className="tabs">
          {files.map(file => (
            <div key={file.id} className="tab-container">
              <button
                onClick={() => setActiveFileId(file.id)}
                className={`tab ${activeFileId === file.id ? "active" : ""}`}
              >
                {file.name}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteFile(file.id);
                }}
                className="delete-button"
                disabled={files.length <= 1}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="controls">
          <button onClick={() => {
            const name = prompt("Enter file name with extension:");
            if (name) {
              addNewFile(name);
            }
          }} className="add-file">
            + New File
          </button>
          <button onClick={handleFormatClick} className="format-button">
            Format Code
          </button>
        </div>
      </div>

      {activeFile && (
        <Editor
          key={activeFileId}
          height="calc(100vh - 70px)"
          language={activeFile.language}
          value={activeFile.content}
          onChange={handleEditorChange}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            automaticLayout: true,
            contextmenu: false,
            formatOnPaste: true,
            formatOnType: true,
          }}
          beforeMount={(monaco) => {
            monaco.editor.defineTheme("myTheme", {
              base: "vs-dark",
              inherit: true,
              rules: [],
              colors: { "editor.background": "#000000" },
            });
          }}
        />
      )}
    </div>
  );
}