import { Monitor, Terminal as TerminalIcon, FolderOpen, Settings, FileText, Calculator, Image, Music } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';

const programs = [
  { icon: TerminalIcon, name: 'Terminal', version: '1.0', size: '2.4 MB' },
  { icon: FolderOpen, name: 'File Explorer', version: '1.0', size: '5.1 MB' },
  { icon: Settings, name: 'Control Panel', version: '1.0', size: '3.2 MB' },
  { icon: FileText, name: 'Notepad', version: '1.0', size: '1.8 MB' },
  { icon: Calculator, name: 'Calculator', version: '1.0', size: '2.0 MB' },
  { icon: Image, name: 'Image Viewer', version: '1.0', size: '4.5 MB' },
  { icon: Music, name: 'Media Player', version: '1.0', size: '6.8 MB' },
  { icon: Monitor, name: 'System Monitor', version: '1.0', size: '3.5 MB' },
];

export function ProgramManager() {
  return (
    <div className="program-manager h-full overflow-auto bg-white">
      {/* Header */}
      <div className="border-b border-gray-300 bg-gray-50 p-4">
        <h2 className="text-gray-800 mb-1">Program Manager</h2>
        <p className="text-gray-600">Manage installed applications</p>
      </div>

      {/* Program List */}
      <div className="p-4">
        <div className="space-y-2">
          {programs.map((program, index) => (
            <Card key={index} className="p-4 border border-gray-200">
              <div className="program-row flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-50 rounded">
                    <program.icon className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-gray-800 mb-1">{program.name}</div>
                    <p className="text-gray-600">
                      Version {program.version} • {program.size}
                    </p>
                  </div>
                </div>
                <div className="program-actions flex gap-2">
                  <Button variant="outline" size="sm">
                    Open
                  </Button>
                  <Button variant="outline" size="sm">
                    Uninstall
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Footer Stats */}
      <div className="border-t border-gray-300 bg-gray-50 p-4 mt-4">
        <p className="text-gray-600">
          Total Programs: {programs.length} • Total Size: 29.3 MB
        </p>
      </div>
    </div>
  );
}
