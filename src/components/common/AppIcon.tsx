import type { HTMLAttributes, SVGProps } from 'react';
import homeIcon from '@/assets/icons/home.svg?raw';
import diaryIcon from '@/assets/icons/diary.svg?raw';
import photoIcon from '@/assets/icons/photo.svg?raw';
import watchingIcon from '@/assets/icons/watching.svg?raw';
import watchlistIcon from '@/assets/icons/watchlist.svg?raw';
import statsIcon from '@/assets/icons/stats.svg?raw';
import settingsIcon from '@/assets/icons/settings.svg?raw';
import searchIcon from '@/assets/icons/search.svg?raw';
import filterIcon from '@/assets/icons/filter.svg?raw';
import editIcon from '@/assets/icons/edit.svg?raw';
import closeIcon from '@/assets/icons/close.svg?raw';
import sortIcon from '@/assets/icons/sort.svg?raw';
import clockIcon from '@/assets/icons/clock.svg?raw';
import sunIcon from '@/assets/icons/sun.svg?raw';
import addIcon from '@/assets/icons/add.svg?raw';
import moonIcon from '@/assets/icons/moon.svg?raw';

export type AppIconName =
  | 'home' | 'diary' | 'photo' | 'watching' | 'watchlist' | 'stats' | 'settings'
  | 'search' | 'filter' | 'edit' | 'add' | 'sort' | 'folder' | 'star' | 'clock'
  | 'calendar' | 'screen' | 'sun' | 'moon' | 'chevronLeft' | 'chevronRight'
  | 'chevronDown' | 'chevronUp' | 'close' | 'check' | 'image' | 'doubleChevronLeft'
  | 'doubleChevronRight' | 'download' | 'warning' | 'trash';

interface AppIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  name: AppIconName;
  title?: string;
}

const PROVIDED_ICONS: Partial<Record<AppIconName, string>> = {
  home: homeIcon,
  diary: diaryIcon,
  photo: photoIcon,
  watching: watchingIcon,
  watchlist: watchlistIcon,
  stats: statsIcon,
  settings: settingsIcon,
  search: searchIcon,
  filter: filterIcon,
  edit: editIcon,
  close: closeIcon,
  sort: sortIcon,
  clock: clockIcon,
  sun: sunIcon,
  add: addIcon,
  moon: moonIcon,
  // 按用户指定复用此前提供的原图。
  image: photoIcon,
  calendar: diaryIcon,
};

// 用户提供的图标保持原始路径；其余图标采用同一 200px 画板和圆角描边语言补齐。
export default function AppIcon({ name, title, className, ...props }: AppIconProps) {
  const providedIcon = PROVIDED_ICONS[name];
  if (providedIcon) {
    return (
      <span
        {...(props as HTMLAttributes<HTMLSpanElement>)}
        role={title ? 'img' : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        className={`app-icon app-icon-source${className ? ` ${className}` : ''}`}
        dangerouslySetInnerHTML={{ __html: providedIcon }}
      />
    );
  }

  const shared = { fill: 'currentColor' };

  const content = (() => {
    switch (name) {
      case 'folder': return <path {...shared} d="M20 58a20 20 0 0 1 20-20h43l19 20h58a20 20 0 0 1 20 20v74a20 20 0 0 1-20 20H40a20 20 0 0 1-20-20V58Zm18 16v78c0 1 1 2 2 2h120c1 0 2-1 2-2V78c0-1-1-2-2-2H94L75 58H40c-1 0-2 1-2 2v14Z" />;
      case 'star': return <path {...shared} d="m100 18 25 52 57 8-41 40 10 57-51-28-51 28 10-57-41-40 57-8 25-52Z" />;
      case 'screen': return <path {...shared} d="M30 28h140a20 20 0 0 1 20 20v89a20 20 0 0 1-20 20h-54v17h23a9 9 0 1 1 0 18H61a9 9 0 1 1 0-18h23v-17H30a20 20 0 0 1-20-20V48a20 20 0 0 1 20-20Zm0 18c-1 0-2 1-2 2v89c0 1 1 2 2 2h140c1 0 2-1 2-2V48c0-1-1-2-2-2H30Z" />;
      case 'chevronLeft': return <path {...shared} d="M122 35 57 100l65 65 13-13-52-52 52-52-13-13Z" />;
      case 'chevronRight': return <path {...shared} d="m78 35-13 13 52 52-52 52 13 13 65-65L78 35Z" />;
      case 'chevronDown': return <path {...shared} d="m35 78 13-13 52 52 52-52 13 13-65 65L35 78Z" />;
      case 'chevronUp': return <path {...shared} d="m35 122 13 13 52-52 52 52 13-13-65-65-65 65Z" />;
      case 'doubleChevronLeft': return <path {...shared} d="m110 35-65 65 65 65 13-13-52-52 52-52-13-13Zm45 0-65 65 65 65 13-13-52-52 52-52-13-13Z" />;
      case 'doubleChevronRight': return <path {...shared} d="m90 35-13 13 52 52-52 52 13 13 65-65L90 35Zm45 0-13 13 52 52-52 52 13 13 65-65-65-65Z" />;
      case 'check': return <path {...shared} d="m75 156-51-51 13-13 38 38 88-88 13 13-101 101Z" />;
      case 'trash': return <path {...shared} d="M72 26h56l8 14h30v18H34V40h30l8-14Zm-20 48h96v91a19 19 0 0 1-19 19H71a19 19 0 0 1-19-19V74Zm25 20v50h14V94H77Zm32 0v50h14V94h-14Z" />;
      case 'download': return <path {...shared} d="M91 20h18v85l27-27 13 13-49 49-49-49 13-13 27 27V20Zm-55 130h128a18 18 0 0 1 18 18v12H18v-12a18 18 0 0 1 18-18Z" />;
      case 'warning': return <path {...shared} d="M86 28c6-11 22-11 28 0l71 123c6 11-2 25-14 25H29c-12 0-20-14-14-25L86 28Zm5 45v46h18V73H91Zm0 62v18h18v-18H91Z" />;
      default: return null;
    }
  })();

  return <svg viewBox="0 0 200 200" fill="none" className={`app-icon${className ? ` ${className}` : ''}`} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} {...props}>{title && <title>{title}</title>}{content}</svg>;
}
