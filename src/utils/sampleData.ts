import { Post, GuestbookEntry, WebBadge } from '../types';

export const RETRO_SVGS = {
  pixelCamera: 'https://picsum.photos/id/250/200/200',
  pixelWorkstation: 'https://picsum.photos/id/1/800/800',
  pixelSkyline: 'https://picsum.photos/id/338/800/800',
  pixelCassette: 'https://picsum.photos/id/250/800/800',
  pixelArcade: 'https://placebear.com/800/800'
};

export const INITIAL_POSTS: Post[] = [
  {
    id: 'post-1',
    author: 'root@neogram',
    handle: ':> cyber_phantom',
    avatar: '👾',
    timestamp: '1996-10-19 23:42:11 EST',
    imageSrc: RETRO_SVGS.pixelWorkstation,
    filter: 'crt',
    caption: ':> Booted custom BSD workstation. Check the pixel desk setup: large steaming coffee mug, compact keyboard, oversized mousepad, and potted cactus up on the top shelf. Blinking monitor & keyboard LEDs are soothing during late night dial-up compiles.',
    mood: '[:> CODING IN THE DARK]',
    webring: 'unix.hackers.retro',
    location: 'Sparcstation // Node #4',
    likes: 42,
    radicals: 19,
    bookmarks: 8,
    comments: [
      {
        id: 'c-1',
        author: 'sysadmin_claire',
        avatar: '💾',
        timestamp: '1996-10-19 23:55 EST',
        text: ':> Radical sprite work! The tonal shading on the beige casing and the steam from the coffee mug give it so much cozy depth.'
      },
      {
        id: 'c-2',
        author: 'pixel_monk',
        avatar: '📼',
        timestamp: '1996-10-20 00:14 EST',
        text: ':> Love the clean borderless LEDs and the compact keyboard balance!'
      }
    ]
  },
  {
    id: 'post-2',
    author: 'neon_runner',
    handle: ':> akiba_pilot',
    avatar: '🌆',
    timestamp: '1996-10-18 19:15:02 JST',
    imageSrc: RETRO_SVGS.pixelSkyline,
    filter: 'cyberpunk',
    caption: ':> Neon dusk over Akihabara. Snapped with my low-res digital camera. Check the blinking radio tower beacon on the skyline.',
    mood: '[:> VIBING TO CITY POP]',
    webring: 'neocities.cyberpunk',
    location: 'Electric Town Chome 4',
    likes: 88,
    radicals: 64,
    bookmarks: 31,
    comments: [
      {
        id: 'c-3',
        author: 'lynx_browser',
        avatar: '🕹️',
        timestamp: '1996-10-18 20:30 JST',
        text: ':> Renders beautifully even on low-bitrate displays!'
      }
    ]
  },
  {
    id: 'post-3',
    author: 'analog_witch',
    handle: ':> tape_trader',
    avatar: '🎧',
    timestamp: '1996-10-17 14:02:44 GMT',
    imageSrc: RETRO_SVGS.pixelCassette,
    filter: 'sepia',
    caption: ':> Master copy recorded on chrome Type II cassette. The reels are spinning at full speed. Postal mail trading only!',
    mood: '[:> PRESSING PLAY]',
    webring: 'audio.lofi.cassette',
    location: 'London Studio Node',
    likes: 54,
    radicals: 32,
    bookmarks: 14,
    comments: []
  }
];

export const INITIAL_GUESTBOOK: GuestbookEntry[] = [
  {
    id: 'gb-1',
    name: 'AcidBurn_01',
    website: 'http://www.geocities.com/SiliconValley/Pond/1337',
    location: 'Detroit, MI',
    message: ':> Cool site! Found you from the Webring. Love the Mac and Unix elements. Bookmarked!',
    date: 'OCT 19, 1996 21:04',
    moodIcon: '😎'
  },
  {
    id: 'gb-2',
    name: 'ZeroCool_Gibson',
    website: 'http://members.tripod.com/~gibson_runner',
    location: 'New York, NY',
    message: ':> Hack the Planet! Snagged your 88x31 button for my personal directory.',
    date: 'OCT 18, 1996 16:32',
    moodIcon: '💾'
  },
  {
    id: 'gb-3',
    name: 'WebSurfer99',
    website: 'http://www.angelfire.com/zine/netwave',
    location: 'Toronto, Canada',
    message: ':> Your guestbook is so retro-cool. Signed and logged via Netscape Navigator!',
    date: 'OCT 17, 1996 09:12',
    moodIcon: '✨'
  }
];

export const RETRO_BADGES: WebBadge[] = [
  {
    id: 'b-1',
    title: 'MADE WITH',
    subtitle: 'VI / EMACS',
    bgColor: '#ffffff',
    textColor: '#000080',
    accentBg: '#000080',
    accentText: '#ffffff'
  },
  {
    id: 'b-2',
    title: 'NETSCAPE',
    subtitle: 'NOW 4.0',
    bgColor: '#000000',
    textColor: '#00ffcc',
    accentBg: '#006699',
    accentText: '#ffffff'
  },
  {
    id: 'b-3',
    title: 'MAC OS',
    subtitle: 'COMPATIBLE',
    bgColor: '#dcd8d0',
    textColor: '#000000',
    accentBg: '#333333',
    accentText: '#ffffff'
  },
  {
    id: 'b-4',
    title: 'UNIX BSD',
    subtitle: 'POWERED',
    bgColor: '#161b22',
    textColor: '#39ff14',
    accentBg: '#ff0055',
    accentText: '#ffffff'
  },
  {
    id: 'b-5',
    title: 'NO COOKIES',
    subtitle: 'PRIVATE',
    bgColor: '#00ff00',
    textColor: '#000000',
    accentBg: '#004400',
    accentText: '#00ff00'
  },
  {
    id: 'b-6',
    title: 'NEOCITIES',
    subtitle: 'NEIGHBOR',
    bgColor: '#000080',
    textColor: '#ffffff',
    accentBg: '#ffff00',
    accentText: '#000000'
  }
];
