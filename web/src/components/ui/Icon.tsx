// Ícones do painel — Iconify + Lucide importados **localmente** (offline).
//
// Cada ícone é importado como dado (`@iconify-icons/lucide/<nome>`) e passado
// ao `<Icon>` como objeto, então nada é buscado em api.iconify.design em tempo
// de execução: o bundle carrega só os ícones usados.
import { Icon as Iconify } from '@iconify/react';

import activity from '@iconify-icons/lucide/activity';
import calendar from '@iconify-icons/lucide/calendar';
import check from '@iconify-icons/lucide/check';
import chevronDown from '@iconify-icons/lucide/chevron-down';
import chevronLeft from '@iconify-icons/lucide/chevron-left';
import chevronUp from '@iconify-icons/lucide/chevron-up';
import externalLink from '@iconify-icons/lucide/external-link';
import info from '@iconify-icons/lucide/info';
import key from '@iconify-icons/lucide/key';
import layoutGrid from '@iconify-icons/lucide/layout-grid';
import listOrdered from '@iconify-icons/lucide/list-ordered';
import logIn from '@iconify-icons/lucide/log-in';
import logOut from '@iconify-icons/lucide/log-out';
import mapPin from '@iconify-icons/lucide/map-pin';
import monitor from '@iconify-icons/lucide/monitor';
import moon from '@iconify-icons/lucide/moon';
import newspaper from '@iconify-icons/lucide/newspaper';
import pencil from '@iconify-icons/lucide/pencil';
import plus from '@iconify-icons/lucide/plus';
import radio from '@iconify-icons/lucide/radio';
import refreshCw from '@iconify-icons/lucide/refresh-cw';
import settings from '@iconify-icons/lucide/settings';
import slidersHorizontal from '@iconify-icons/lucide/sliders-horizontal';
import sun from '@iconify-icons/lucide/sun';
import trash from '@iconify-icons/lucide/trash-2';
import trophy from '@iconify-icons/lucide/trophy';
import user from '@iconify-icons/lucide/user';
import userPlus from '@iconify-icons/lucide/user-plus';
import x from '@iconify-icons/lucide/x';

export const ICONS = {
  activity,
  calendar,
  check,
  chevronDown,
  chevronLeft,
  chevronUp,
  externalLink,
  info,
  key,
  layoutGrid,
  listOrdered,
  logIn,
  logOut,
  mapPin,
  monitor,
  moon,
  newspaper,
  pencil,
  plus,
  radio,
  refreshCw,
  settings,
  slidersHorizontal,
  sun,
  trash,
  trophy,
  user,
  userPlus,
  x,
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  /** Tamanho em px (padrão 16). */
  size?: number;
  className?: string;
  /** Rótulo acessível; sem ele o ícone é considerado decorativo. */
  title?: string;
}

export function Icon({ name, size = 16, className, title }: IconProps) {
  return (
    <Iconify
      icon={ICONS[name]}
      width={size}
      height={size}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    />
  );
}
