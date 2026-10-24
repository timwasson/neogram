# Semantic BEM Theming & Custom CSS Guide

This guide explains how Neogram styles your static gallery output and how you can attach custom CSS to customize your static photo gallery to match your personal site aesthetic.

---

## 1. The Dual Styling Strategy

Neogram uses a deliberate two-tier styling architecture:

```
+--------------------------------------------------------------------------+
|  1. WORKSTATION APP (views/index.njk, views/directory.njk)              |
|  - Internal creation dashboard for you as creator                        |
|  - Fast internal UI assembly using zero-dependency utilities (.flex,     |
|    .p-4, .font-mono) and workstation components (.pixel-box, .pixel-btn) |
+--------------------------------------------------------------------------+
                                    vs.
+--------------------------------------------------------------------------+
|  2. STATIC GALLERY DELIVERABLE (eleventy/src/ pushed to Neocities)       |
|  - Public gallery viewed by your visitors                                |
|  - Strictly Semantic BEM classes (.neogram-*) at base specificity (0,1,0)|
|  - ZERO ad-hoc utility classes                                           |
|  - 100% customizable with your own external stylesheet                   |
+--------------------------------------------------------------------------+
```

### Why Base Specificity `(0, 1, 0)` Matters:
When other tools output hundreds of utility classes like `p-4 text-xs font-bold bg-[#111]`, static site owners have to write horrific CSS selectors or pepper `!important` across their stylesheets just to change a border or color.

In Neogram, every static gallery element is styled with a single class selector at base specificity `(0, 1, 0)`. You can override any element effortlessly:

```css
/* Customizing Neogram on your site is as simple as this: */
.neogram-card {
  border: 2px solid #ff00ff;
  border-radius: 8px;
  background: #110022;
}
```

---

## 2. BEM Class Hierarchy Reference

All elements in the generated static site (`dist/static-galleries/<userId>/`) follow this strict BEM specification:

### Site Shell & Layout
| Class | Description |
|---|---|
| `.neogram-site` | Top-level container wrapper |
| `.neogram-site__taskbar` | Retro header taskbar |
| `.neogram-site__branding` | Logo and station title cluster |
| `.neogram-site__main` | Main content area container |
| `.neogram-site__footer` | Bottom taskbar and credits |

### Gallery Grid & Photo Cards
| Class | Description |
|---|---|
| `.neogram-grid` | Multi-column responsive CSS grid container |
| `.neogram-card` | Window card container for an individual photo |
| `.neogram-card__header` | Card title bar with author call-sign |
| `.neogram-card__media` | Viewport container for the photo thumbnail |
| `.neogram-card__image` | The `<img>` element displaying the photo |
| `.neogram-card__body` | Text area containing metadata and caption |
| `.neogram-card__caption` | The creator's caption text |
| `.neogram-card__tags` | Metadata pills (mood, location, webring) |
| `.neogram-card__footer` | Bottom bar with likes counter and comment count |

### Photo Detail & Comments Ledger
| Class | Description |
|---|---|
| `.neogram-detail` | Container for single photo view (`photos/<id>/index.html`) |
| `.neogram-detail__viewport` | High-res 1200px image display viewport |
| `.neogram-comments` | Interactive comments ledger container |
| `.neogram-comments__item` | Individual comment bubble |
| `.neogram-comments__author` | Commenter's handle and avatar |
| `.neogram-comments__body` | Comment message text |
| `.neogram-comments__form` | New comment submission form |

### Buttons & Badges
| Class | Modifiers | Description |
|---|---|---|
| `.neogram-btn` | `--sm`, `--lg`, `--primary`, `--yellow`, `--accent`, `--cyan`, `--success`, `--danger` | Reusable retro push buttons with 3D bevel shadow |
| `.neogram-badge` | `--cyan`, `--magenta`, `--amber`, `--green` | Micro status indicator pills |

---

## 3. Injecting Your Custom CSS (`custom_css_url`)

You can link any external CSS stylesheet directly into your static gallery without modifying any code:

1. In the Neogram Workstation, navigate to the **⚙ Settings** tab.
2. In the **STATION CONFIGURATION** card, locate:
   ```
   CUSTOM CSS URL (EXTERNAL STYLESHEET):
   https://your-site.neocities.org/css/my-custom-theme.css
   ```
3. Enter the URL of your stylesheet hosted on Neocities, GitHub, or any public web server.
4. Click **`[ 💾 SAVE SETTINGS ]`**.
5. Eleventy automatically injects a `<link rel="stylesheet" href="...">` tag into the `<head>` of all generated static gallery pages.

---

## 4. Ready-to-Use Custom Theme Templates

Below are complete, copy-and-paste stylesheets you can save to `custom-theme.css` on your Neocities site.

### Theme 1: Neon Cyberpunk 2077
```css
/* Neon Cyberpunk Theme for Neogram */
body.neogram-site {
  background: #0d001a;
  color: #00ffff;
  font-family: 'Courier New', monospace;
}

.neogram-card, .neogram-banner {
  background: #190033;
  border: 2px solid #ff007f;
  box-shadow: 4px 4px 0px 0px #00ffff;
}

.neogram-card__header, .neogram-banner__header {
  background: #ff007f;
  color: #ffffff;
}

.neogram-btn {
  background: #ff007f;
  color: #ffffff;
  border: 2px solid #00ffff;
  box-shadow: 2px 2px 0px 0px #00ffff;
}

.neogram-btn:hover {
  background: #00ffff;
  color: #000000;
}
```

### Theme 2: Windows 95 Silver Classic
```css
/* Windows 95 Silver Theme for Neogram */
body.neogram-site {
  background: #008080; /* Classic Win95 Teal */
  color: #000000;
  font-family: 'MS Sans Serif', Tahoma, sans-serif;
}

.neogram-card, .neogram-banner {
  background: #c0c0c0;
  border-top: 2px solid #ffffff;
  border-left: 2px solid #ffffff;
  border-right: 2px solid #808080;
  border-bottom: 2px solid #808080;
  box-shadow: 1px 1px 0px 0px #000000;
}

.neogram-card__header, .neogram-banner__header {
  background: #000080; /* Windows Navy Titlebar */
  color: #ffffff;
  font-weight: bold;
}

.neogram-btn {
  background: #c0c0c0;
  color: #000000;
  border-top: 2px solid #ffffff;
  border-left: 2px solid #ffffff;
  border-right: 2px solid #808080;
  border-bottom: 2px solid #808080;
  box-shadow: 1px 1px 0px 0px #000000;
}
```

### Theme 3: Apple System 7 Platinum
```css
/* Apple System 7 Platinum Theme for Neogram */
body.neogram-site {
  background: #737373;
  color: #000000;
  font-family: 'Geneva', 'Lucida Grande', sans-serif;
}

.neogram-card {
  background: #e0e0e0;
  border: 2px solid #000000;
  box-shadow: 3px 3px 0px 0px rgba(0, 0, 0, 0.4);
}

.neogram-card__header {
  background: repeating-linear-gradient(
    to bottom,
    #000000 0px,
    #000000 1px,
    transparent 1px,
    transparent 3px
  );
  color: #000000;
  border-bottom: 2px solid #000000;
}
```
