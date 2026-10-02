import { Monitor, Volume2, Wifi, Palette, Shield, Clock, HardDrive, Users } from 'lucide-react';
import { Card } from './ui/card';

const controlItems = [
  { icon: Monitor, label: 'Display', description: 'Adjust screen resolution' },
  { icon: Volume2, label: 'Sound', description: 'Manage audio devices' },
  { icon: Wifi, label: 'Network', description: 'Network and Internet settings' },
  { icon: Palette, label: 'Personalization', description: 'Themes and colors' },
  { icon: Shield, label: 'Security', description: 'Privacy and security' },
  { icon: Clock, label: 'Date & Time', description: 'Set time and timezone' },
  { icon: HardDrive, label: 'Storage', description: 'Manage storage space' },
  { icon: Users, label: 'User Accounts', description: 'Manage user accounts' },
];

export function ControlPanel() {
  return (
    <div className="control-panel h-full overflow-auto bg-gray-50 p-6">
      <div className="mb-4">
        <h2 className="text-gray-800 mb-1">Control Panel</h2>
        <p className="text-gray-600">Adjust your computer's settings</p>
      </div>

      <div className="control-panel-grid grid grid-cols-2 gap-4">
        {controlItems.map((item, index) => (
          <Card
            key={index}
            className="p-4 hover:shadow-lg cursor-pointer transition-shadow border border-gray-200"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded">
                <item.icon className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <div className="text-gray-800 mb-1">{item.label}</div>
                <p className="text-gray-600">{item.description}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
