export type RetroFilter = 'none' | 'crt' | 'vga' | 'gameboy' | 'cyberpunk' | 'sepia';

export type ThemeSkin = 'win95' | 'cyberpunk' | 'geocities' | 'matrix';

export interface Comment {
  id: string;
  author: string;
  avatar: string;
  timestamp: string;
  text: string;
}

export interface Post {
  id: string;
  author: string;
  handle: string;
  avatar: string;
  timestamp: string;
  imageSrc: string;
  filter: RetroFilter;
  caption: string;
  mood: string;
  webring: string;
  location: string;
  likes: number;
  radicals: number;
  bookmarks: number;
  comments: Comment[];
  userLiked?: boolean;
  userRadical?: boolean;
}

export interface GuestbookEntry {
  id: string;
  name: string;
  website: string;
  location: string;
  message: string;
  date: string;
  moodIcon: string;
}

export interface WebBadge {
  id: string;
  title: string;
  subtitle: string;
  bgColor: string;
  textColor: string;
  accentBg: string;
  accentText: string;
}
