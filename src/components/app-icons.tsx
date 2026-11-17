import React from 'react';
import {
  AppWindow,
  BarChart3,
  BookOpen,
  CalendarClock,
  CircleDollarSign,
  FileCheck2,
  FileText,
  Inbox,
  PhoneCall,
  Workflow,
} from 'lucide-react';

export function getWorkspaceAppIcon(
  appId: string
): React.ComponentType<{ className?: string }> {
  switch (appId) {
    case 'forms-studio':
      return FileText;
    case 'workflow-automation':
      return Workflow;
    case 'app-management':
      return AppWindow;
    case 'appointment-scheduler':
      return CalendarClock;
    case 'call-operations':
      return PhoneCall;
    case 'support-inbox':
      return Inbox;
    case 'document-workflow':
      return FileCheck2;
    case 'business-analytics':
      return BarChart3;
    case 'cost-control-center':
      return CircleDollarSign;
    case 'knowledge-hub':
      return BookOpen;
    default:
      return AppWindow;
  }
}
