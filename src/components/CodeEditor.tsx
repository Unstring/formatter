import { useState, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import * as prettier from "prettier/standalone";
import * as parserBabel from "prettier/parser-babel";
import * as parserHtml from "prettier/parser-html";
import * as parserPostcss from "prettier/parser-postcss";

interface File {
  id: string;
  name: string;
  content: string;
  language: string;
}

const DB_NAME = "codeEditorDB";
const STORE_NAME = "files";
const DB_VERSION = 1;

const languageMap: { [key: string]: string } = {
  js: "javascript",
  ts: "typescript",
  html: "html",
  css: "css",
  json: "json",
};

const prettierParserMap: { [key: string]: string } = {
  js: "babel",
  ts: "typescript",
  html: "html",
  css: "css",
  json: "json",
};

export default function CodeEditor() {
  const [files, setFiles] = useState<File[]>([]);
  const [activeFileId, setActiveFileId] = useState<string>("");
  const [editorValue, setEditorValue] = useState("");
  const [db, setDb] = useState<IDBDatabase | null>(null);

  // Initialize IndexedDB
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
      setDb(db);
      loadFilesFromDB(db);
    };

    openDB.onerror = (event) => {
      console.error(
        "Database error:",
        (event.target as IDBOpenDBRequest).error
      );
    };
  }, []);

  useEffect(() => {
    const activeFile = files.find((file) => file.id === activeFileId);
    setEditorValue(activeFile?.content || "");
  }, [activeFileId, files]);

  // Load files from IndexedDB
  const loadFilesFromDB = (db: IDBDatabase) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const savedFiles = request.result;
      if (savedFiles.length > 0) {
        setFiles(savedFiles);
        setActiveFileId(savedFiles[0].id);
        setEditorValue(savedFiles[0].content);
      } else {
        addNewFile("index.js");
      }
    };

    request.onerror = () => {
      console.error("Error loading files:", request.error);
    };
  };

  // Save files to IndexedDB whenever files change
  useEffect(() => {
    if (db && files.length > 0) {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      files.forEach((file) => {
        store.put(file);
      });

      transaction.oncomplete = () => {
        console.log("Files saved to DB");
      };

      transaction.onerror = () => {
        console.error("Error saving files:", transaction.error);
      };
    }
  }, [files, db]);

  const getFileExtension = (fileName: string) => {
    return fileName.split(".").pop()?.toLowerCase() || "js";
  };

  const addNewFile = useCallback(
    (fileName: string) => {
      const existingFile = files.find((f) => f.id === fileName);
      if (existingFile) {
        alert("File with this name already exists!");
        return;
      }

      const extension = getFileExtension(fileName);
      const newFile = {
        id: fileName,
        name: fileName,
        content: "",
        language: languageMap[extension] || "javascript",
      };
      setFiles((prevFiles) => [...prevFiles, newFile]);
      setActiveFileId(fileName);
      setEditorValue("");
    },
    [files]
  );

  const handleAddFile = () => {
    const fileName = prompt("Enter file name with extension (e.g., app.js):");
    if (fileName) {
      addNewFile(fileName);
    }
  };

  const handleDeleteFile = (fileId: string) => {
    if (files.length === 1) {
      alert("You need at least one file!");
      return;
    }

    if (db) {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.delete(fileId);

      setFiles((prevFiles) => {
        const updatedFiles = prevFiles.filter((file) => file.id !== fileId);
        // Switch to first file if current active is deleted
        if (fileId === activeFileId) {
          setActiveFileId(updatedFiles[0].id);
          setEditorValue(updatedFiles[0].content);
        }
        return updatedFiles;
      });
    }
  };

  const formatCode = async (
    code: string,
    extension: string
  ): Promise<string> => {
    try {
      return prettier.format(code, {
        parser: prettierParserMap[extension] || "babel",
        plugins: [parserBabel, parserHtml, parserPostcss],
        semi: true,
        singleQuote: true,
        jsxBracketSameLine: false,
      });
    } catch (error) {
      console.error("Formatting error:", error);
      return code;
    }
  };

  const handleFormatClick = async () => {
    if (!activeFile) return;

    const extension = getFileExtension(activeFile.name);
    const formatted = await formatCode(editorValue, extension);

    setFiles(
      files.map((file) =>
        file.id === activeFileId ? { ...file, content: formatted } : file
      )
    );
    setEditorValue(formatted);
  };

  const handleEditorChange = (value: string | undefined) => {
    const newValue = value || "";
    setEditorValue(newValue);
    setFiles(
      files.map((file) =>
        file.id === activeFileId ? { ...file, content: newValue } : file
      )
    );
  };

  const activeFile = files.find((file) => file.id === activeFileId);

  return (
    <div className="editor-container">
      <div className="tabs-container">
        <div className="tabs">
          {files.map((file) => (
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
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="controls">
          <button onClick={handleAddFile} className="add-file">
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
        defaultLanguage={activeFile.language}
        language={activeFile.language}
        value={editorValue}
        onChange={handleEditorChange}
        beforeMount={(monaco) => {
          monaco.editor.defineTheme("myTheme", {
            base: "vs-dark",
            inherit: true,
            rules: [],
            colors: { "editor.background": "#000000" },
          });
        }}
        theme="myTheme"
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          formatOnPaste: false,
          formatOnType: false,
          automaticLayout: true,
          contextmenu: false, // Disables right-click context menu
        }}
        onMount={(editor) => {
          editor.onContextMenu((e) => e.event.preventDefault()); // Prevent Monaco's context menu
        }}
      />
      
      )}
    </div>
  );
}
