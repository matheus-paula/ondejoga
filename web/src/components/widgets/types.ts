import type { AppConfig, Dashboard, LayoutWidget } from '../../api/types';

export interface WidgetProps {
  widget: LayoutWidget;
  data: Dashboard;
  config: AppConfig;
}
