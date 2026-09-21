/**
 * Icon registry. Data, not a component — `Icon.tsx` reads this.
 *
 * Only the icons the screens use. The SVGs are drawn with
 * stroke="currentColor", so a single `color` prop tints any of them.
 */

import AlertTriangle from '../../assets/icons/alert-triangle.svg';
import ChartEmpty from '../../assets/icons/chart-empty.svg';
import Check from '../../assets/icons/check.svg';
import ChevronLeft from '../../assets/icons/chevron-left.svg';
import ChevronRight from '../../assets/icons/chevron-right.svg';
import Close from '../../assets/icons/close.svg';
import Energy from '../../assets/icons/energy.svg';
import Goal from '../../assets/icons/goal.svg';
import History from '../../assets/icons/history.svg';
import Home from '../../assets/icons/home.svg';
import InfoCircle from '../../assets/icons/info-circle.svg';
import Pencil from '../../assets/icons/pencil.svg';
import Plus from '../../assets/icons/plus.svg';
import Settings from '../../assets/icons/settings.svg';
import ShieldCheck from '../../assets/icons/shield-check.svg';
import Sleep from '../../assets/icons/sleep.svg';
import Steps from '../../assets/icons/steps.svg';
import Sync from '../../assets/icons/sync.svg';
import Trash from '../../assets/icons/trash.svg';
import UploadCloud from '../../assets/icons/upload-cloud.svg';
import Water from '../../assets/icons/water.svg';
import Weight from '../../assets/icons/weight.svg';
import WifiOff from '../../assets/icons/wifi-off.svg';
import Workout from '../../assets/icons/workout.svg';

export const ICONS = {
  'alert-triangle': AlertTriangle,
  'chart-empty': ChartEmpty,
  check: Check,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  close: Close,
  energy: Energy,
  goal: Goal,
  history: History,
  home: Home,
  'info-circle': InfoCircle,
  pencil: Pencil,
  plus: Plus,
  settings: Settings,
  'shield-check': ShieldCheck,
  sleep: Sleep,
  steps: Steps,
  sync: Sync,
  trash: Trash,
  'upload-cloud': UploadCloud,
  water: Water,
  weight: Weight,
  'wifi-off': WifiOff,
  workout: Workout,
} as const;

export type IconName = keyof typeof ICONS;
