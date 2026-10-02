import { useState, useRef, useEffect } from 'react';

export function Terminal() {
  const [history, setHistory] = useState<string[]>([
    'WebOS Terminal v1.0',
    'Type "help" for available commands.',
    '',
  ]);
  const [currentInput, setCurrentInput] = useState('');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const executeCommand = (cmd: string) => {
    const trimmedCmd = cmd.trim().toLowerCase();
    let output = '';

    switch (trimmedCmd) {
      case 'help':
        output = `Available commands:
  help     - Show this help message
  clear    - Clear the terminal
  date     - Show current date and time
  echo     - Echo text back
  ls       - List directory contents
  about    - About this OS`;
        break;
      case 'clear':
        setHistory(['WebOS Terminal v1.0', 'Type "help" for available commands.', '']);
        return;
      case 'date':
        output = new Date().toString();
        break;
      case 'ls':
        output = `Documents/  Downloads/  Pictures/  Music/  Videos/`;
        break;
      case 'about':
        output = `WebOS - A virtual operating system built with React`;
        break;
      case '':
        break;
      default:
        if (trimmedCmd.startsWith('echo ')) {
          output = cmd.substring(5);
        } else {
          output = `Command not found: ${cmd}. Type "help" for available commands.`;
        }
    }

    if (trimmedCmd !== 'clear') {
      setHistory((prev) => [...prev, `> ${cmd}`, output, '']);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeCommand(currentInput);
      setCurrentInput('');
    }
  };

  return (
    <div className="terminal h-full bg-black text-green-400 p-4 font-mono overflow-auto">
      <div className="space-y-1">
        {history.map((line, index) => (
          <div key={index} className="whitespace-pre-wrap">
            {line}
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span>{'>'}</span>
          <input
            type="text"
            value={currentInput}
            onChange={(e) => setCurrentInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent outline-none text-green-400"
            autoFocus
          />
        </div>
      </div>
      <div ref={terminalEndRef} />
    </div>
  );
}
