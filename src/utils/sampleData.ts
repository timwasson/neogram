import { Post, GuestbookEntry, WebBadge } from '../types';

export const RETRO_SVGS = {
  // 8-Bit Pixel Camera Sprite (for the big upload button & presets)
  pixelCamera: `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="100%" height="100%" style="image-rendering: pixelated; shape-rendering: crispEdges;">
      <rect width="120" height="120" fill="transparent" />
      
      <!-- Flash Mount (Shaded pixel blocks) -->
      <rect x="42" y="14" width="36" height="14" fill="#323846" />
      <rect x="44" y="16" width="32" height="10" fill="#4d5568" />
      <rect x="44" y="16" width="32" height="2" fill="#717d98" />
      <rect x="52" y="19" width="16" height="5" fill="#79c0ff" />
      
      <!-- Blinking Red Recording LED (Clean glowing pixel, NO BORDER) -->
      <rect x="18" y="19" width="10" height="8" fill="#ff0033">
        <animate attributeName="fill" values="#ff0033;#550000;#ff0033" dur="0.8s" repeatCount="indefinite"/>
      </rect>
      
      <!-- Big Shutter Button -->
      <rect x="22" y="21" width="16" height="6" fill="#e6b800" />
      <rect x="22" y="21" width="16" height="2" fill="#fff066" />
      <rect x="22" y="25" width="16" height="2" fill="#997a00" />

      <!-- Main Camera Outer Silhouette (Dark tonal edge) -->
      <rect x="10" y="26" width="100" height="80" fill="#20242c" />
      
      <!-- Highlight Bevel (Top & Left) -->
      <rect x="12" y="28" width="96" height="76" fill="#6d768a" />
      <!-- Shadow Bevel (Bottom & Right) -->
      <rect x="14" y="32" width="94" height="72" fill="#383d47" />
      <!-- Body Surface -->
      <rect x="14" y="30" width="92" height="72" fill="#4f5666" />

      <!-- Textured Grip Block -->
      <rect x="14" y="30" width="26" height="72" fill="#2b2f38" />
      <rect x="14" y="30" width="2" height="72" fill="#424856" />
      <line x1="20" y1="34" x2="20" y2="98" stroke="#1d2026" stroke-width="2" />
      <line x1="26" y1="34" x2="26" y2="98" stroke="#1d2026" stroke-width="2" />
      <line x1="32" y1="34" x2="32" y2="98" stroke="#1d2026" stroke-width="2" />

      <!-- Viewfinder Module -->
      <rect x="76" y="34" width="22" height="18" fill="#1b1d24" />
      <rect x="78" y="36" width="18" height="14" fill="#2d3340" />
      <rect x="81" y="39" width="12" height="8" fill="#58a6ff" />
      <rect x="83" y="41" width="4" height="4" fill="#ffffff" />

      <!-- Chunky Shaded Lens Housing -->
      <rect x="44" y="42" width="54" height="54" fill="#181b22" />
      <rect x="46" y="44" width="50" height="50" fill="#636c7e" />
      <rect x="48" y="46" width="46" height="46" fill="#252a34" />
      <rect x="52" y="50" width="38" height="38" fill="#3b4352" />
      <rect x="56" y="54" width="30" height="30" fill="#12151b" />
      
      <!-- Lens Glass & Reflection -->
      <rect x="60" y="58" width="22" height="22" fill="#1f6feb" />
      <rect x="64" y="62" width="14" height="14" fill="#388bfd" />
      <rect x="63" y="61" width="5" height="5" fill="#ffffff" />
      <rect x="72" y="70" width="3" height="3" fill="#ffffff" />
    </svg>
  `)}`,

  // Chunky Pixel Workstation with Tonal Shading, No-Border LEDs, and Rich Desk Decor
  pixelWorkstation: `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%" style="image-rendering: pixelated; shape-rendering: crispEdges;">
      
      <!-- 1. Wall Background with 90s Pixel Diamond Wallpaper -->
      <rect width="400" height="400" fill="#141923" />
      <pattern id="pixelWallpaper" width="24" height="24" patternUnits="userSpaceOnUse">
        <rect width="24" height="24" fill="#141923" />
        <!-- Pixel Diamond Motif -->
        <rect x="11" y="2" width="2" height="2" fill="#232b3b" />
        <rect x="9" y="4" width="6" height="2" fill="#232b3b" />
        <rect x="7" y="6" width="10" height="2" fill="#232b3b" />
        <rect x="9" y="8" width="6" height="2" fill="#232b3b" />
        <rect x="11" y="10" width="2" height="2" fill="#232b3b" />
        <!-- Small Star Accent -->
        <rect x="23" y="14" width="1" height="1" fill="#343f54" />
        <rect x="0" y="14" width="1" height="1" fill="#343f54" />
        <rect x="12" y="20" width="1" height="1" fill="#343f54" />
      </pattern>
      <rect width="400" height="280" fill="url(#pixelWallpaper)" />

      <!-- Pinned 8-bit Sticky Note on Wall -->
      <rect x="330" y="45" width="42" height="42" fill="#ffef7a" />
      <rect x="330" y="45" width="42" height="2" fill="#fff7b0" />
      <rect x="330" y="85" width="42" height="2" fill="#d9c748" />
      <rect x="335" y="52" width="30" height="2" fill="#bfae34" />
      <rect x="335" y="58" width="24" height="2" fill="#bfae34" />
      <rect x="335" y="64" width="28" height="2" fill="#bfae34" />
      <!-- Red Pushpin -->
      <rect x="349" y="42" width="4" height="5" fill="#ff2244" />

      <!-- Desk Surface with Tonal Pixel Wood Grain -->
      <rect x="0" y="280" width="400" height="120" fill="#4d3522" />
      <!-- Wood Top Highlight Plank -->
      <rect x="0" y="280" width="400" height="6" fill="#8c6240" />
      <rect x="0" y="286" width="400" height="4" fill="#69482d" />
      <!-- Shadow band under monitor/equipment -->
      <rect x="60" y="286" width="280" height="8" fill="#382516" />
      <rect x="0" y="380" width="400" height="20" fill="#332114" />

      <!-- 2. DESK DECOR: Larger Ceramic Coffee Mug with Animated Steam (Left Side) -->
      <g id="pixelCoffeeMug">
        <!-- Coaster -->
        <rect x="20" y="344" width="48" height="5" fill="#2b231c" />
        <rect x="22" y="345" width="44" height="3" fill="#3d3228" />
        
        <!-- Mug Silhouette -->
        <rect x="24" y="300" width="34" height="44" fill="#323c4a" />
        <!-- Mug Highlight (Left) -->
        <rect x="26" y="302" width="3" height="40" fill="#ffffff" />
        <!-- Mug Body (Beige ceramic) -->
        <rect x="29" y="302" width="23" height="40" fill="#dedbd2" />
        <!-- Retro Teal Stripe on Mug -->
        <rect x="26" y="316" width="29" height="9" fill="#208080" />
        <rect x="26" y="317" width="29" height="2" fill="#33b3b3" />
        <!-- Mug Shadow (Right) -->
        <rect x="52" y="302" width="4" height="40" fill="#aba596" />
        <!-- Complete Solid 8-Bit Handle Loop -->
        <rect x="56" y="308" width="14" height="28" fill="#323c4a" />
        <rect x="56" y="310" width="12" height="24" fill="#dedbd2" />
        <rect x="56" y="310" width="2" height="24" fill="#ffffff" />
        <rect x="66" y="310" width="2" height="24" fill="#aba596" />
        <!-- Handle Hole Cutout (Clean 4-sided loop) -->
        <rect x="58" y="315" width="6" height="14" fill="#4d3522" />
        <!-- Hot Coffee Liquid Surface Inside -->
        <rect x="26" y="300" width="29" height="4" fill="#3a1e0f" />
        <rect x="28" y="301" width="25" height="2" fill="#522b15" />
        
        <!-- Animated Pixel Steam -->
        <g id="pixelSteam">
          <rect x="33" y="290" width="4" height="6" fill="#9aa5b5" opacity="0.8">
            <animate attributeName="y" values="290;272;290" dur="2.4s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.8;0.1;0.8" dur="2.4s" repeatCount="indefinite"/>
          </rect>
          <rect x="42" y="286" width="4" height="7" fill="#9aa5b5" opacity="0.6">
            <animate attributeName="y" values="286;266;286" dur="2.8s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2.8s" repeatCount="indefinite"/>
          </rect>
        </g>
      </g>

      <!-- 3. DESK DECOR: Potted 8-Bit Mini Cactus (MOVED WAY UP TO THE TOP OF THE DESK) -->
      <g id="pixelCactus">
        <!-- Terracotta Pot on Top Desk Ledge -->
        <rect x="342" y="258" width="30" height="6" fill="#d46b3b" />
        <rect x="344" y="264" width="26" height="18" fill="#a84d22" />
        <rect x="346" y="264" width="22" height="16" fill="#be5929" />
        <!-- Pot Highlight -->
        <rect x="344" y="264" width="3" height="16" fill="#e87c4a" />
        <!-- Soil -->
        <rect x="345" y="256" width="24" height="3" fill="#291a12" />
        <!-- Cactus Stem -->
        <rect x="351" y="234" width="12" height="23" fill="#2d7a3e" />
        <rect x="353" y="234" width="8" height="23" fill="#3ea656" />
        <rect x="353" y="234" width="2" height="23" fill="#57c772" />
        <!-- Left Arm -->
        <rect x="346" y="242" width="7" height="4" fill="#3ea656" />
        <rect x="346" y="238" width="4" height="7" fill="#3ea656" />
        <!-- Right Arm -->
        <rect x="360" y="245" width="7" height="4" fill="#3ea656" />
        <rect x="363" y="241" width="4" height="7" fill="#3ea656" />
        <!-- Tiny Pink Flower on top -->
        <rect x="355" y="230" width="4" height="4" fill="#ff1a8c" />
        <rect x="356" y="231" width="2" height="2" fill="#ffff33" />
      </g>

      <!-- 4. CRT MONITOR (TONAL SPRITE SHADING - No Harsh Black Borders!) -->
      <g id="crtMonitor">
        <!-- Outermost Silhouette Bevel (Dark warm charcoal tone #4a4539, NOT #000) -->
        <rect x="76" y="36" width="248" height="216" fill="#4a4539" />
        
        <!-- Outer Highlight Bevel (Top & Left Cream Edge) -->
        <rect x="78" y="38" width="242" height="4" fill="#f0ecde" />
        <rect x="78" y="38" width="4" height="210" fill="#f0ecde" />
        
        <!-- Outer Shadow Bevel (Bottom & Right Tan Edge) -->
        <rect x="80" y="246" width="242" height="4" fill="#918874" />
        <rect x="320" y="40" width="4" height="210" fill="#918874" />

        <!-- Main Monitor Casing Plastic (Warm 90s Workstation Beige) -->
        <rect x="82" y="42" width="238" height="204" fill="#d3cca8" />

        <!-- Inner Recessed Bezel Rim (Recessed shadow) -->
        <rect x="94" y="52" width="214" height="170" fill="#665f50" />
        <!-- Inner Highlight (Bottom & Right of cavity) -->
        <rect x="96" y="54" width="210" height="166" fill="#8a816e" />
        <rect x="98" y="56" width="206" height="162" fill="#403b30" />

        <!-- CRT Glass Tube Face (Deep phosphor surface) -->
        <rect x="102" y="60" width="198" height="152" fill="#051608" />
        
        <!-- Subtle Glass Curvature Highlight (Top & Left edge of tube) -->
        <rect x="104" y="62" width="194" height="2" fill="#0d3815" />
        <rect x="104" y="62" width="2" height="148" fill="#0d3815" />

        <!-- Green Phosphor Terminal Screen Text -->
        <text x="114" y="86" fill="#39ff14" font-family="'Space Mono', 'Courier', monospace" font-size="12" font-weight="bold">neogram@sparc:~# ./boot</text>
        <text x="114" y="106" fill="#39ff14" font-family="'Space Mono', 'Courier', monospace" font-size="11">BSD-UNIX 4.4 / X11-R6</text>
        <text x="114" y="124" fill="#39ff14" font-family="'Space Mono', 'Courier', monospace" font-size="11">VFS MOUNT: /dev/sd0 OK</text>
        <text x="114" y="146" fill="#39ff14" font-family="'Space Mono', 'Courier', monospace" font-size="12" font-weight="bold">:&gt; ready_</text>

        <!-- Blinking Terminal Cursor Block -->
        <rect x="180" y="136" width="9" height="12" fill="#39ff14">
          <animate attributeName="opacity" values="1;0;1" dur="0.8s" repeatCount="indefinite"/>
        </rect>

        <!-- Monitor Brand Badge Strip -->
        <rect x="175" y="228" width="50" height="8" fill="#3a372e" />
        <rect x="178" y="230" width="44" height="4" fill="#212019" />
        <rect x="182" y="231" width="16" height="2" fill="#ffb000" />

        <!-- Monitor Power LED (CLEAN GLOWING PHOSPHOR SQUARE - NO BORDER AT ALL!) -->
        <rect x="282" y="228" width="8" height="8" fill="#39ff14">
          <animate attributeName="opacity" values="1;0.2;1" dur="1.8s" repeatCount="indefinite"/>
        </rect>

        <!-- Monitor Swivel Neck & Stand (Tonal Shaded) -->
        <rect x="160" y="246" width="80" height="16" fill="#595243" />
        <rect x="162" y="246" width="76" height="14" fill="#a39a84" />
        <!-- Stand Base -->
        <rect x="136" y="262" width="128" height="18" fill="#4a4437" />
        <rect x="138" y="264" width="124" height="3" fill="#f0ecde" />
        <rect x="138" y="267" width="124" height="12" fill="#c4bc9f" />
      </g>

      <!-- 5. KEYBOARD (NARROWER & SHRUNK FOR COMPACT WORKSTATION BALANCE) -->
      <g id="chunkyKeyboard">
        <!-- Narrower Keyboard Outer Silhouette Rim -->
        <rect x="104" y="306" width="192" height="58" fill="#4d4638" />
        <!-- Keyboard Highlight (Top & Left) -->
        <rect x="106" y="308" width="186" height="3" fill="#f4efe2" />
        <rect x="106" y="308" width="3" height="52" fill="#f4efe2" />
        <!-- Main Chassis -->
        <rect x="108" y="311" width="184" height="50" fill="#c7bfa3" />
        <!-- Key Well (Recessed darker shadow) -->
        <rect x="112" y="316" width="176" height="40" fill="#6b6352" />
        <rect x="114" y="318" width="172" height="36" fill="#8a806b" />

        <!-- Individual Chunky Keys with Top Highlight & Bottom Shadow -->
        <!-- Function Row -->
        <rect x="116" y="320" width="168" height="5" fill="#ded7c5" />
        <!-- Key Row 1 -->
        <rect x="116" y="327" width="168" height="6" fill="#ded7c5" />
        <rect x="116" y="332" width="168" height="1" fill="#756c59" />
        <!-- Key Row 2 -->
        <rect x="116" y="335" width="168" height="6" fill="#ded7c5" />
        <rect x="116" y="340" width="168" height="1" fill="#756c59" />
        <!-- Key Row 3 -->
        <rect x="116" y="343" width="168" height="6" fill="#ded7c5" />
        <rect x="116" y="348" width="168" height="1" fill="#756c59" />

        <!-- Spacebar Accent Key -->
        <rect x="156" y="344" width="76" height="5" fill="#ece6d5" />
        <rect x="156" y="348" width="76" height="1" fill="#756c59" />

        <!-- Keyboard Status LEDs (CLEAN GLOWING SQUARES - NO BORDER AT ALL!) -->
        <!-- Num Lock Amber LED (Blinking) -->
        <rect x="264" y="321" width="6" height="4" fill="#ffb000">
          <animate attributeName="opacity" values="1;0.1;1" dur="1.2s" repeatCount="indefinite"/>
        </rect>
        <!-- Caps Lock Green LED -->
        <rect x="273" y="321" width="6" height="4" fill="#39ff14">
          <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2.5s" repeatCount="indefinite"/>
        </rect>
      </g>

      <!-- 6. DESK DECOR: 8-Bit Mouse & Mousepad (IN LINE WITH KEYBOARD) -->
      <g id="pixelMouse">
        <!-- Cyan/Navy Mousepad (Aligned vertically with keyboard y=306..364) -->
        <rect x="312" y="306" width="76" height="58" fill="#0d1e2e" />
        <rect x="314" y="308" width="72" height="54" fill="#153654" />
        <rect x="316" y="310" width="68" height="50" fill="#1b466e" />

        <!-- Beige 2-Button Mouse Body (Centered on Pad) -->
        <rect x="334" y="318" width="32" height="36" fill="#4d4638" />
        <rect x="336" y="320" width="28" height="32" fill="#d3cca8" />
        <rect x="336" y="320" width="3" height="32" fill="#f4efe2" />
        <!-- Left & Right Buttons Split -->
        <rect x="336" y="320" width="13" height="14" fill="#eae4d3" />
        <rect x="351" y="320" width="13" height="14" fill="#eae4d3" />
        <rect x="349" y="320" width="2" height="14" fill="#807663" />
        <rect x="336" y="333" width="28" height="2" fill="#807663" />

        <!-- Mouse Wire Running in Stepped Pixel Pattern to Back of Desk -->
        <path d="M 350 318 L 350 296 L 332 296 L 332 284 L 254 284" stroke="#363228" stroke-width="2" fill="none" />
      </g>

    </svg>
  `)}`,

  // 8-Bit Pixel City Skyline with Tonal Shading & Glowing Beacons
  pixelSkyline: `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%" style="image-rendering: pixelated; shape-rendering: crispEdges;">
      <rect width="400" height="400" fill="#0c071d" />
      
      <!-- Distant Stars (Tonal twinkle pixels) -->
      <rect x="40" y="30" width="2" height="2" fill="#ffffff" />
      <rect x="110" y="55" width="2" height="2" fill="#ff79c6" />
      <rect x="290" y="40" width="2" height="2" fill="#8be9fd" />
      <rect x="360" y="70" width="2" height="2" fill="#ffffff" />

      <!-- Giant 8-bit Vaporwave Sun -->
      <rect x="140" y="100" width="120" height="120" fill="#ff007f" />
      <!-- Horizontal pixel cutouts -->
      <rect x="140" y="150" width="120" height="8" fill="#0c071d" />
      <rect x="140" y="170" width="120" height="12" fill="#0c071d" />
      <rect x="140" y="194" width="120" height="18" fill="#0c071d" />

      <!-- Shaded Blocky Skyline (Tonal neon rims, not black outlines) -->
      <!-- Building 1 -->
      <rect x="18" y="196" width="64" height="154" fill="#0d0822" />
      <rect x="20" y="198" width="60" height="150" fill="#18103d" />
      <rect x="20" y="198" width="2" height="150" fill="#00e5ff" />
      
      <!-- Building 2 with Radio Antenna -->
      <rect x="88" y="156" width="74" height="194" fill="#0d0822" />
      <rect x="90" y="158" width="70" height="190" fill="#140b30" />
      <rect x="90" y="158" width="2" height="190" fill="#bd93f9" />
      <!-- Antenna Mast -->
      <rect x="123" y="136" width="4" height="22" fill="#50fa7b" />
      <!-- Blinking Beacon Light (NO BORDER) -->
      <rect x="122" y="132" width="6" height="6" fill="#ff0044">
        <animate attributeName="opacity" values="1;0.1;1" dur="1s" repeatCount="indefinite"/>
      </rect>

      <!-- Building 3 -->
      <rect x="168" y="186" width="64" height="164" fill="#0d0822" />
      <rect x="170" y="188" width="60" height="160" fill="#24154f" />
      <rect x="170" y="188" width="2" height="160" fill="#ff79c6" />

      <!-- Building 4 -->
      <rect x="238" y="146" width="84" height="204" fill="#0d0822" />
      <rect x="240" y="148" width="80" height="200" fill="#0f0724" />
      <rect x="240" y="148" width="2" height="200" fill="#00e5ff" />

      <!-- Building 5 -->
      <rect x="328" y="206" width="64" height="144" fill="#0d0822" />
      <rect x="330" y="208" width="60" height="140" fill="#1e1145" />
      <rect x="330" y="208" width="2" height="140" fill="#ff79c6" />

      <!-- Illuminated Window Grid -->
      <rect x="34" y="215" width="8" height="8" fill="#f1fa8c" />
      <rect x="52" y="215" width="8" height="8" fill="#f1fa8c" />
      <rect x="34" y="235" width="8" height="8" fill="#8be9fd" />
      <rect x="52" y="235" width="8" height="8" fill="#8be9fd" />
      <rect x="106" y="175" width="10" height="10" fill="#50fa7b" />
      <rect x="130" y="175" width="10" height="10" fill="#50fa7b" />
      <rect x="106" y="200" width="10" height="10" fill="#ffb86c" />
      <rect x="260" y="168" width="10" height="10" fill="#ff79c6" />
      <rect x="285" y="168" width="10" height="10" fill="#8be9fd" />

      <!-- Ground Wireframe Grid with Tonal Phosphor Lines -->
      <rect x="0" y="348" width="400" height="52" fill="#070314" />
      <rect x="0" y="348" width="400" height="2" fill="#00e5ff" />
      <line x1="0" y1="365" x2="400" y2="365" stroke="#00b4d8" stroke-width="2" />
      <line x1="0" y1="382" x2="400" y2="382" stroke="#7209b7" stroke-width="2" />
    </svg>
  `)}`,

  // 8-Bit Pixel Cassette Tape with Spinning Animated Hubs & Tonal Shading
  pixelCassette: `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%" style="image-rendering: pixelated; shape-rendering: crispEdges;">
      <rect width="400" height="400" fill="#181818" />
      
      <!-- Cassette Shell Outer Bevel (Dark charcoal rim) -->
      <rect x="38" y="78" width="324" height="234" fill="#383327" />
      <!-- Top Highlight -->
      <rect x="40" y="80" width="320" height="4" fill="#f5eed7" />
      <rect x="40" y="80" width="4" height="226" fill="#f5eed7" />
      <!-- Shadow Bevel -->
      <rect x="44" y="304" width="316" height="4" fill="#8c8269" />
      <!-- Shell Body (Vintage warm beige) -->
      <rect x="44" y="84" width="312" height="220" fill="#d8cca8" />

      <!-- Inset Label Area -->
      <rect x="58" y="98" width="284" height="154" fill="#59523f" />
      <rect x="60" y="100" width="280" height="150" fill="#ede5cb" />
      
      <!-- Label Header Strip -->
      <rect x="60" y="100" width="280" height="46" fill="#e62e5c" />
      <rect x="60" y="100" width="280" height="3" fill="#ff668a" />
      <text x="75" y="130" fill="#ffffff" font-family="'Space Mono', 'Courier', monospace" font-size="15" font-weight="bold">CYBER_BEATS '96 [SIDE A]</text>

      <!-- Center Window Cavity -->
      <rect x="108" y="158" width="184" height="84" fill="#262420" />
      <rect x="110" y="160" width="180" height="80" fill="#0d0d0d" />
      
      <!-- Left Reel with rotation animation -->
      <g transform="translate(155, 200)">
        <rect x="-22" y="-22" width="44" height="44" fill="#ffffff" />
        <rect x="-22" y="-22" width="44" height="3" fill="#ffffff" />
        <rect x="-10" y="-10" width="20" height="20" fill="#111111" />
        <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="4s" repeatCount="indefinite"/>
      </g>

      <!-- Right Reel with rotation animation -->
      <g transform="translate(245, 200)">
        <rect x="-22" y="-22" width="44" height="44" fill="#ffffff" />
        <rect x="-10" y="-10" width="20" height="20" fill="#111111" />
        <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="4s" repeatCount="indefinite"/>
      </g>

      <!-- Magnetic Tape Ribbon Line -->
      <line x1="177" y1="200" x2="223" y2="200" stroke="#52391e" stroke-width="12" />

      <!-- Bottom Trapezoid Block -->
      <rect x="98" y="268" width="204" height="42" fill="#524a38" />
      <rect x="100" y="270" width="200" height="38" fill="#b8ad8a" />
      <rect x="130" y="285" width="12" height="12" fill="#1a1a1a" />
      <rect x="258" y="285" width="12" height="12" fill="#1a1a1a" />
    </svg>
  `)}`,

  // 8-Bit Pixel Arcade Machine with Shaded Cabinet
  pixelArcade: `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%" style="image-rendering: pixelated; shape-rendering: crispEdges;">
      <rect width="400" height="400" fill="#0d1117" />
      
      <!-- Cabinet Frame (Tonal Indigo/Plum) -->
      <rect x="96" y="36" width="208" height="348" fill="#130c24" />
      <rect x="100" y="40" width="200" height="340" fill="#2b1b47" />
      <!-- Side T-molding Accent (Cyan Bevel) -->
      <rect x="100" y="40" width="4" height="340" fill="#00ffcc" />
      <rect x="296" y="40" width="4" height="340" fill="#ff007f" />
      
      <!-- Marquee Sign -->
      <rect x="108" y="48" width="184" height="54" fill="#3d2200" />
      <rect x="110" y="50" width="180" height="50" fill="#ffcc00" />
      <text x="120" y="86" fill="#ff0055" font-family="'Impact', monospace" font-size="28" font-weight="bold">NEO-BYTE</text>

      <!-- Chunky Bezel & Screen -->
      <rect x="118" y="113" width="164" height="134" fill="#100a1c" />
      <rect x="120" y="115" width="160" height="130" fill="#1e1338" />
      <!-- Inset Screen -->
      <rect x="133" y="126" width="134" height="108" fill="#000033" />
      <rect x="135" y="128" width="130" height="104" fill="#000080" />
      
      <!-- Screen Text -->
      <text x="145" y="155" fill="#ffff00" font-family="'Space Mono', monospace" font-size="13" font-weight="bold">1UP: 042900</text>
      
      <!-- Blinking "INSERT COIN" -->
      <text x="145" y="195" fill="#00ffcc" font-family="'Space Mono', monospace" font-size="12" font-weight="bold">
        :&gt; INSERT COIN
        <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/>
      </text>

      <!-- Control Panel -->
      <rect x="98" y="253" width="204" height="48" fill="#4d001f" />
      <rect x="100" y="255" width="200" height="44" fill="#d4145a" />
      <!-- Joystick -->
      <rect x="138" y="263" width="16" height="16" fill="#ff0000" />
      <!-- Buttons (Clean Glowing Pixels) -->
      <rect x="180" y="268" width="10" height="10" fill="#00ffff" />
      <rect x="205" y="268" width="10" height="10" fill="#ffff00" />
      <rect x="230" y="268" width="10" height="10" fill="#00ff66" />

      <!-- Coin Door Frame -->
      <rect x="143" y="313" width="114" height="58" fill="#1f1f1f" />
      <rect x="145" y="315" width="110" height="54" fill="#2e2e2e" />
      <!-- Coin Slots (Glowing Orange inserts) -->
      <rect x="165" y="325" width="18" height="24" fill="#ff9900" />
      <rect x="172" y="328" width="4" height="14" fill="#111111" />
      <rect x="215" y="325" width="18" height="24" fill="#ff9900" />
      <rect x="222" y="328" width="4" height="14" fill="#111111" />
    </svg>
  `)}`
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
