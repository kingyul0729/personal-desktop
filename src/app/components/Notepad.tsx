import { useState } from 'react';
import { Save, FolderOpen, File } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

export function Notepad() {
  const [content, setContent] = useState('');

  return (
    <div className="notepad h-full flex flex-col">
      {/* Menu Bar */}
      <div className="border-b border-gray-300 bg-gray-50 p-2 flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-2">
          <File className="h-4 w-4" />
          New
        </Button>
        <Button variant="ghost" size="sm" className="gap-2">
          <FolderOpen className="h-4 w-4" />
          Open
        </Button>
        <Button variant="ghost" size="sm" className="gap-2">
          <Save className="h-4 w-4" />
          Save
        </Button>
      </div>

      {/* Text Editor */}
      <div className="flex-1 p-4">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Start typing..."
          className="w-full h-full resize-none border-none focus-visible:ring-0 font-mono"
        />
      </div>

      {/* Status Bar */}
      <div className="border-t border-gray-300 bg-gray-50 px-4 py-1 flex items-center justify-between">
        <span className="text-gray-600">
          Length: {content.length} characters
        </span>
        <span className="text-gray-600">
          Lines: {content.split('\n').length}
        </span>
      </div>
    </div>
  );
}
