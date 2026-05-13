/* =============================================================================
 * Spiders III — game.js
 * Single-file IIFE (do not split further; uses let/const internal scope).
 *
 * NAVIGATION: every major subsystem starts with a header comment of the form
 *   // ── <SECTION NAME> ──────────────────────────────────────
 * grep for "// ── " to list all sections. Major sections in source order:
 *
 *   Config                       (top of IIFE)
 *   LAYOUT_* level data          (LAYOUT_HALLWAY_OUT .. LAYOUT_ORDERED_ESCAPE)
 *   MAX_LEVEL = <N>              (highest built-in level)
 *   LEVEL_ORDER                  (source of truth for level progression)
 *   State                        (the `state` object)
 *   Spider-free mode helpers
 *   Level Cleared modal
 *   Score helpers
 *   Board DOM
 *   Helpers
 *   Random placement
 *   Effect handlers
 *   Button helpers
 *   Min-turns BFS
 *   Spider AI
 *   Movement
 *   Lock / Unlock public API
 *   Animated traverse token (overlay)
 *   Edit mode
 *   Direction picker
 *   Custom levels (Save-layout tool)
 *   Render
 *   Setup overlay flow
 *   Cell-sized border clicks
 *   Keyboard movement (arrow keys + WASD)
 *
 * To add a level, see _agent/rules in the workspace OR /memories/repo/spiders3-gotchas.md.
 * ============================================================================= */

    (() => {
      'use strict';

      // ── Config ────────────────────────────────────────────────────────────
      const COLS = 10;
      const ROWS = 10;
      // 0-indexed internally; rendered as 1-indexed (1..10) in the UI.
      //
      // IN_CELL and OUT_CELL are const references, but their .c / .r
      // fields are mutable. Some levels relocate IN (e.g. Level 11 "Ford
      // the River" puts IN on the right) or OUT (e.g. Level 6 "No Way
      // Out" hides OUT inside the board). init() always resets BOTH
      // back to their defaults at the top of the function before any
      // per-level branch runs, and render() re-applies the .in / .out
      // classes + labels each frame so the visuals follow whatever
      // IN_CELL / OUT_CELL currently point to.
      const DEFAULT_IN_CELL  = { c: 0, r: 0 };
      const DEFAULT_OUT_CELL = { c: 9, r: 9 };
      const IN_CELL  = { c: 0, r: 0 };  // shown as (1, 1) by default
      const OUT_CELL = { c: 9, r: 9 };  // shown as (10, 10) by default

      // Sample placements for env effects. Edit at runtime via the "Edit cells" button.
      // Coords here are 0-indexed [col, row].
      const EFFECT_COUNTS = {
        slide: 3,
        knight: 3,
        lava: 3,
        tnt: 3,
      };
      const SPIDER_COUNT = 4;
      // Level names and dispatch derive from LEVEL_ORDER, defined further
      // below after the LAYOUT_* data constants. Reorder LEVEL_ORDER to
      // swap slot positions — names, BFS bailout, corridor mode, and the
      // level-jump pad all follow automatically.
      // LAYOUT_HALLWAY ("Hallway"): tutorial layout — a 10x3 corridor
      // (rows 0..2) with a small boulder maze and two cakes. IN sits at
      // the default top-left corner; OUT relocates to UI (10, 3) (the
      // bottom-right of the 3-row strip). The body.corridor-mode CSS
      // class hides rows 3..9 so the player only sees the 3-row strip.
      // Coords are 0-indexed; UI labels in comments are 1-indexed.
      const LAYOUT_HALLWAY_OUT = { c: 9, r: 2 }; // UI (10, 3)
      const LAYOUT_HALLWAY_BOULDERS = [
        // Row 1: leave a single gap at UI (3,1) where a cake sits.
        { c: 1, r: 0 }, { c: 3, r: 0 }, { c: 9, r: 0 }, // UI ( 2,1), ( 4,1), (10,1)
        // Row 2: alternating boulders form a zig-zag through the middle,
        // with a tight cluster at UI (6,2)–(8,2) that gates the right side.
        { c: 1, r: 1 }, { c: 3, r: 1 }, { c: 5, r: 1 }, { c: 6, r: 1 }, { c: 7, r: 1 }, // UI ( 2,2), ( 4,2), ( 6,2), ( 7,2), ( 8,2)
        // Row 3: cluster on the right forces the player to detour
        // through UI (7, 3) where the spider lurks.
        { c: 5, r: 2 }, { c: 7, r: 2 }, { c: 8, r: 2 }, // UI ( 6,3), ( 8,3), ( 9,3)
      ];
      const LAYOUT_HALLWAY_CAKES = [
        { c: 2, r: 0 }, // UI ( 3, 1) — early reward in the gap on row 1
      ];
      const LAYOUT_HALLWAY_SPIDERS = [
        { c: 6, r: 2 }, // UI ( 7, 3) — lone spider blocking the corridor to OUT
      ];
      // LAYOUT_SPIDER_LOVE ("Spider Love"): a warm-up — no env effects, just a
      // small pack of spiders, four weapons stacked in the center of the grid,
      // and a boulder arch around the cluster.
      //
      // Layout authored via the in-game Save-layout tool. Coords are
      // 0-indexed array positions (UI labels show them 1-indexed).
      // IN is at default (0,0) / UI (1,1); OUT is at default (9,9) /
      // UI (10,10). Five spiders: one isolated in the top-right corridor
      // at row 3 col 9, then a four-spider pack along the lower-left
      // edge from rows 6–8.
      const LAYOUT_SPIDER_LOVE_SPIDER_CELLS = [
        { c: 9, r: 3 }, // UI (10, 4) — lone spider on the upper corridor
        { c: 0, r: 6 }, // UI ( 1, 7)
        { c: 0, r: 7 }, // UI ( 1, 8)
        { c: 1, r: 7 }, // UI ( 2, 8)
        { c: 0, r: 8 }, // UI ( 1, 9)
      ];
      const LAYOUT_SPIDER_LOVE_WEAPON_CELLS = [
        { c: 4, r: 4 }, { c: 5, r: 4 },
        { c: 4, r: 5 }, { c: 5, r: 5 },
      ];
      // Boulder "arch" surrounding the central weapon cluster. The
      // arch caps rows 3 and 6 (UI rows 4 and 7) and seals east/west
      // entries on rows 4–5, forcing the player to step into the
      // cluster from the top with the gap at (5,3) (UI (6,4)).
      // Coords are 0-indexed; UI labels in comments are 1-indexed.
      const LAYOUT_SPIDER_LOVE_BOULDERS = [
        // Top of the arch (row 3 / UI row 4): three boulders with the
        // entry gap at (5,3) (UI (6,4)).
        { c: 3, r: 3 }, { c: 4, r: 3 }, { c: 6, r: 3 },
        // Sides of the arch (rows 4–5 / UI rows 5–6): block east/west
        // entry into the weapon cluster.
        { c: 3, r: 4 }, { c: 6, r: 4 },
        { c: 3, r: 5 }, { c: 6, r: 5 },
        // Bottom of the arch (row 6 / UI row 7): fully sealed.
        { c: 3, r: 6 }, { c: 4, r: 6 }, { c: 5, r: 6 }, { c: 6, r: 6 },
      ];
      // Hand-placed cakes on LAYOUT_SPIDER_LOVE along the lower-mid row: one at
      // UI (4,9) and one at UI (7,9). Away from the weapon cluster
      // and from OUT, so the player has to detour to grab them.
      const LAYOUT_SPIDER_LOVE_CAKE_CELLS = [
        { c: 3, r: 8 }, // UI (4, 9)
        { c: 6, r: 8 }, // UI (7, 9)
      ];
      // LAYOUT_KNIGHT_VAULT ("Hoppity Hop"): a hand-placed walled 3x3 cavern
      // in the middle of the board. The 3x3 walkable space spans rows 4–6,
      // cols 4–6 (UI). The 12 cells around it are wall cells with their bars
      // facing INWARD, so the cavern is fully sealed. Five knights ring
      // the cavern: one in the very center of the 3x3, and four just
      // outside each cardinal edge of the wall ring. Stepping SOUTH onto
      // the outside knight from UI ( 5, 1) jumps the player to UI ( 4,
      // 4) — the NW corner of the 3x3. Stepping in any direction from
      // the inner knight jumps the player out to one of the four cells
      // just past the wall ring.
      // Coords are 0-indexed; UI labels in comments are 1-indexed.
      const LAYOUT_KNIGHT_VAULT_KNIGHTS = [
        { c: 4, r: 4 }, // UI ( 5, 5) — inside the 3x3 (center)
        { c: 4, r: 1 }, // UI ( 5, 2) — outside, north of the wall ring
        { c: 1, r: 4 }, // UI ( 2, 5) — outside, west of the wall ring
        { c: 7, r: 4 }, // UI ( 8, 5) — outside, east of the wall ring
        { c: 4, r: 7 }, // UI ( 5, 8) — outside, south of the wall ring
      ];
      const LAYOUT_KNIGHT_VAULT_WALLS = [
        // Top row of the wall ring — bars face SOUTH (into the 3x3).
        { c: 3, r: 2, dirs: [{ dc: 0, dr:  1 }] }, // UI ( 4, 3)
        { c: 4, r: 2, dirs: [{ dc: 0, dr:  1 }] }, // UI ( 5, 3)
        { c: 5, r: 2, dirs: [{ dc: 0, dr:  1 }] }, // UI ( 6, 3)
        // Bottom row of the wall ring — bars face NORTH (into the 3x3).
        { c: 3, r: 6, dirs: [{ dc: 0, dr: -1 }] }, // UI ( 4, 7)
        { c: 4, r: 6, dirs: [{ dc: 0, dr: -1 }] }, // UI ( 5, 7)
        { c: 5, r: 6, dirs: [{ dc: 0, dr: -1 }] }, // UI ( 6, 7)
        // Left column of the wall ring — bars face EAST (into the 3x3).
        { c: 2, r: 3, dirs: [{ dc:  1, dr: 0 }] }, // UI ( 3, 4)
        { c: 2, r: 4, dirs: [{ dc:  1, dr: 0 }] }, // UI ( 3, 5)
        { c: 2, r: 5, dirs: [{ dc:  1, dr: 0 }] }, // UI ( 3, 6)
        // Right column of the wall ring — bars face WEST (into the 3x3).
        { c: 6, r: 3, dirs: [{ dc: -1, dr: 0 }] }, // UI ( 7, 4)
        { c: 6, r: 4, dirs: [{ dc: -1, dr: 0 }] }, // UI ( 7, 5)
        { c: 6, r: 5, dirs: [{ dc: -1, dr: 0 }] }, // UI ( 7, 6)
      ];
      // Four hand-placed spider start positions for Level 2. Three line up
      // along the leftmost column (UI col 1 = c === 0) at rows 5, 7, 9 so
      // the player faces a creeping wall of spiders charging up from the
      // south as they navigate the cavern + knight puzzle. A fourth spider
      // sits inland at UI ( 3, 9) to discourage running for OUT in a
      // straight line down column 4.
      // Coords are 0-indexed; UI labels in comments are 1-indexed.
      const LAYOUT_KNIGHT_VAULT_SPIDER_CELLS = [
        { c: 0, r: 4 }, // UI ( 1,  5)
        { c: 0, r: 6 }, // UI ( 1,  7)
        { c: 0, r: 8 }, // UI ( 1,  9)
        { c: 2, r: 8 }, // UI ( 3,  9) — inland, blocks south-east running
      ];
      // Two treasure chests on LAYOUT_KNIGHT_VAULT (Invisibility Potion). The
      // chests sit at the NW and SE corners of the sealed 3x3 cavern, leaving
      // the NE and SW corners free for the weapon chests below — so the
      // four corners alternate weapon / potion in a checker pattern.
      // The cavern center (4,4) is the inner knight and is intentionally
      // NOT in this list.
      const LAYOUT_KNIGHT_VAULT_POTION_CELLS = [
        { c: 3, r: 3 }, // UI ( 4, 4) — NW corner
        { c: 5, r: 5 }, // UI ( 6, 6) — SE corner
      ];
      // Two Spider Knife chests on LAYOUT_KNIGHT_VAULT, at the NE and SW corners
      // of the cavern (the corners NOT taken by potions). Players who take
      // the inner-knight L-jump get a 50/50 shot at landing on a knife
      // vs a potion, depending on which exit they pick.
      const LAYOUT_KNIGHT_VAULT_WEAPON_CELLS = [
        { c: 5, r: 3 }, // UI ( 6, 4) — NE corner
        { c: 3, r: 5 }, // UI ( 4, 6) — SW corner
      ];
      // One cake near OUT (UI ( 4, 10)) — a small detour reward for
      // players who clear the cavern and want extra points before
      // stepping onto OUT.
      const LAYOUT_KNIGHT_VAULT_CAKE_CELLS = [
        { c: 3, r: 9 }, // UI ( 4, 10)
      ];
      // LAYOUT_HORSE_PLAY ("Horse Play"): hand-authored layout that introduces
      // the Green Knight alongside the regular Knight. Three horizontal
      // wall bands (rows 3, 5, 7 — wallDirs point at the row's near
      // edge) chop the board into knight-only travel lanes; the player
      // has to chain knight L-jumps across the bands to reach OUT in
      // the bottom-right. Two TnT cells punctuate the middle band and
      // one weapon + two cakes reward the careful path. Authored in the
      // Save-layout JSON shape so the entry just hands the data off to
      // applyCustomLevel. Keep this in sync with the in-game editor's
      // schema (cells / inCell / outCell / buttons).
      const LAYOUT_HORSE_PLAY = {
        inCell: { c: 0, r: 0 },
        outCell: { c: 9, r: 9 },
        cells: [
          { c: 2, r: 1, env: 'green-knight' },
          { c: 0, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 1, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 2, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 3, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 4, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 5, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 6, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 7, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 8, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 9, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 0, r: 3, env: 'green-knight' },
          { c: 2, r: 3, env: 'knight' },
          { c: 4, r: 3, env: 'knight' },
          { c: 6, r: 3, env: 'green-knight' },
          { c: 8, r: 3, env: 'knight' },
          { c: 0, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 1, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 2, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 3, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 4, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 5, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 6, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 7, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 8, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 9, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },
          { c: 0, r: 5, env: 'green-knight' },
          { c: 1, r: 5, env: 'tnt' },
          { c: 2, r: 5, cake: true },
          { c: 4, r: 5, env: 'green-knight' },
          { c: 5, r: 5, env: 'tnt' },
          { c: 7, r: 5, weapon: true },
          { c: 8, r: 5, cake: true },
          { c: 9, r: 5, env: 'knight' },
          { c: 0, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },
          { c: 1, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },
          { c: 2, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },
          { c: 3, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },
          { c: 4, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },
          { c: 5, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },
          { c: 6, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },
          { c: 7, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },
          { c: 8, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },
          { c: 9, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },
          { c: 3, r: 7, env: 'green-knight' },
          { c: 8, r: 7, env: 'knight' },
        ],
        buttons: [],
      };
      // LAYOUT_DANGER ("DANGER!!"): hand-placed layout — a minefield of TnT and
      // lava cells littered with spiders. There are no walls, boulders,
      // slides, or portals — just exposed hazards and predators. Three
      // weapon chests are scattered across the grid (top-right corner,
      // center, mid-south wall). One cake sits on the lava-row stripe
      // for a tempting bonus. Roughly half the cells are TnT, a quarter
      // are lava, and the rest hold spiders or pickups. The player has
      // to thread the gaps using one-shot TnT detonations (rocks aren't
      // available here) and the chest-armed knife to whittle down the
      // spider count before charging OUT in the bottom-right corner.
      // Two of the spiders have scripted opening moves that send them
      // straight into adjacent TnT — instant on-grid demos of what TnT
      // does, which also clears two cells of the maze for the player.
      // Coords are 0-indexed; UI labels in comments are 1-indexed.
      const LAYOUT_DANGER_TNT = [
        // Row 1
        { c: 2, r: 0 }, { c: 3, r: 0 }, { c: 5, r: 0 },
        // Row 2
        { c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 },
        // Row 3
        { c: 3, r: 2 }, { c: 7, r: 2 },
        // Row 4
        { c: 2, r: 3 }, { c: 3, r: 3 }, { c: 6, r: 3 }, { c: 7, r: 3 },
        // Row 5
        { c: 2, r: 4 }, { c: 3, r: 4 }, { c: 5, r: 4 },
        // Row 6
        { c: 8, r: 5 }, { c: 9, r: 5 },
        // Row 7
        { c: 0, r: 6 }, { c: 1, r: 6 }, { c: 5, r: 6 },
        // Row 8
        { c: 1, r: 7 }, { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 4, r: 7 }, { c: 5, r: 7 },
        // Row 9
        { c: 0, r: 8 }, { c: 3, r: 8 }, { c: 4, r: 8 }, { c: 7, r: 8 }, { c: 8, r: 8 },
        // Row 10
        { c: 0, r: 9 }, { c: 1, r: 9 }, { c: 7, r: 9 }, { c: 8, r: 9 },
      ];
      // One cell — UI (8, 9) at zero-index (7, 8) — carries BOTH TnT and a
      // spider on the same square: the TnT lives on the cell itself, and
      // the spider is layered on top via LAYOUT_DANGER_SPIDERS. Spawning doesn't
      // trigger the env, so the spider sits there safely until something
      // — player, other spider, or the spider itself moving — sets it off.
      const LAYOUT_DANGER_LAVA = [
        { c: 0, r: 1 }, { c: 5, r: 1 }, { c: 8, r: 1 },                   // Row 2
        { c: 0, r: 2 }, { c: 8, r: 2 },                                   // Row 3
        { c: 0, r: 3 }, { c: 1, r: 3 }, { c: 5, r: 3 }, { c: 8, r: 3 },   // Row 4
        { c: 1, r: 4 },                                                   // Row 5
        { c: 7, r: 5 },                                                   // Row 6
        { c: 2, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 },
        { c: 7, r: 6 }, { c: 8, r: 6 }, { c: 9, r: 6 },                   // Row 7
        { c: 0, r: 7 },                                                   // Row 8
      ];
      const LAYOUT_DANGER_WEAPONS = [
        { c: 9, r: 0 }, // UI (10, 1) — top-right corner, behind a TnT/spider gauntlet
        { c: 5, r: 2 }, // UI ( 6, 3) — center of the upper TnT band
        { c: 0, r: 4 }, // UI ( 1, 5) — left-edge ledge above the cake
        { c: 2, r: 8 }, // UI ( 3, 9) — south stripe between TnT cells
      ];
      const LAYOUT_DANGER_CAKES = [
        { c: 1, r: 5 }, // UI ( 2, 6) — sits next to the central spider cluster
      ];
      // Spiders. Order matters only insofar as the firstMoveDir hooks
      // below reference indices into LAYOUT_DANGER_SPIDERS. The two flagged
      // spiders (UI cells (2, 3) and (3, 3)) get scripted opening moves
      // that walk them onto adjacent TnT cells.
      const LAYOUT_DANGER_SPIDERS = [
        // Row 1
        { c: 6, r: 0 }, { c: 7, r: 0 }, { c: 8, r: 0 },
        // Row 2
        { c: 7, r: 1 },
        // Row 3
        { c: 1, r: 2, firstMoveDir: { dc: 0, dr: -1 } }, // UI (2, 3) — opens UP onto TnT at (1, 1)
        { c: 2, r: 2, firstMoveDir: { dc: 1, dr:  0 } }, // UI (3, 3) — opens RIGHT onto TnT at (3, 2)
        { c: 4, r: 2 }, { c: 6, r: 2 }, { c: 9, r: 2 },
        // Row 5
        { c: 9, r: 4 },
        // Row 6
        { c: 0, r: 5 }, { c: 3, r: 5 }, { c: 4, r: 5 }, { c: 6, r: 5 },
        // Row 8
        { c: 7, r: 7 }, { c: 8, r: 7 }, { c: 9, r: 7 },
        // Row 9
        { c: 1, r: 8 }, { c: 5, r: 8 }, { c: 6, r: 8 }, { c: 7, r: 8 }, { c: 9, r: 8 },
        // Row 10
        { c: 2, r: 9 }, { c: 3, r: 9 }, { c: 4, r: 9 }, { c: 5, r: 9 }, { c: 6, r: 9 },
      ];
      // LAYOUT_CHIPS_ESCAPE ("Chip's Escape") hand-placed layout: a
      // portal labyrinth dotted with hazards, treasure, and patrolling
      // spiders. Boulders carve the grid into a serpentine maze so the
      // player must mix foot travel with five portal pairs (purple,
      // yellow, blue, red, green) to reach OUT. A single slide cell at
      // (0,3) and a network of rocks/keys/locks/tnt/lava give the
      // player multiple puzzle beats along the way. Coords are
      // 0-indexed; UI labels in comments are 1-indexed.
      const LAYOUT_CHIPS_ESCAPE_BOULDERS = [
        // Row 1: top-edge posts flanking the red portal at (4,0) and
        // the weapon chest at (8,0).
        { c: 5, r: 0 }, { c: 7, r: 0 },                                   // UI ( 6,1), ( 8,1)
        // Row 2: choke cells flanking the potion / key-rock pickups
        // and the TnT cell.
        { c: 0, r: 1 }, { c: 4, r: 1 }, { c: 5, r: 1 }, { c: 7, r: 1 },
        // Row 3: rock band that hides most of the upper half from foot
        // traversal — gap at (3,2) and the spider cell (6,2) is open.
        { c: 1, r: 2 }, { c: 2, r: 2 }, { c: 5, r: 2 },
        { c: 7, r: 2 }, { c: 8, r: 2 }, { c: 9, r: 2 },
        // Row 4: wall across the middle with gaps at (0,3) (slide),
        // (2,3) (spider), (3,3), and (6,3) (rock).
        { c: 1, r: 3 }, { c: 4, r: 3 }, { c: 5, r: 3 },
        { c: 7, r: 3 }, { c: 8, r: 3 }, { c: 9, r: 3 },
        // Row 5: lone boulder funneling traversal toward the purple
        // portal at (4,4).
        { c: 3, r: 4 },                                                   // UI ( 4,5)
        // Row 6: rock band guarding the corridor between the purple
        // portal at (4,4) and the yellow portal at (9,4).
        { c: 1, r: 5 }, { c: 3, r: 5 }, { c: 4, r: 5 }, { c: 5, r: 5 },
        { c: 7, r: 5 }, { c: 8, r: 5 }, { c: 9, r: 5 },
        // Rows 7–8: vertical posts at cols 1, 5, 7 keeping the
        // approach to OUT to the row-9 corridor.
        { c: 1, r: 6 }, { c: 5, r: 6 }, { c: 7, r: 6 },                   // UI ( 2,7), ( 6,7), ( 8,7)
        { c: 1, r: 7 }, { c: 5, r: 7 }, { c: 7, r: 7 },                   // UI ( 2,8), ( 6,8), ( 8,8)
        // Row 9: near-solid wall (cols 1–5, 7–8) — south approach to
        // row 10 is via the portals or the lava-flanked rock at (5,9).
        { c: 1, r: 8 }, { c: 2, r: 8 }, { c: 3, r: 8 }, { c: 4, r: 8 }, { c: 5, r: 8 },
        { c: 7, r: 8 }, { c: 8, r: 8 },
      ];
      const LAYOUT_CHIPS_ESCAPE_SLIDES = [
        { c: 0, r: 3 }, // UI ( 1, 4) — single slide cell on the west wall
      ];
      const LAYOUT_CHIPS_ESCAPE_PORTALS = [          // purple
        { c: 4, r: 4, dir: { dc: -1, dr:  0 } }, // UI ( 5, 5):  bar WEST — purple A
        { c: 7, r: 9, dir: { dc:  0, dr: -1 } }, // UI ( 8,10): bar NORTH — purple B
      ];
      const LAYOUT_CHIPS_ESCAPE_PORTALS_YELLOW = [
        { c: 9, r: 4, dir: { dc:  1, dr:  0 } }, // UI (10, 5):  bar EAST off-grid — yellow A
        { c: 0, r: 9, dir: { dc:  0, dr:  1 } }, // UI ( 1,10):  bar SOUTH off-grid — yellow B
      ];
      const LAYOUT_CHIPS_ESCAPE_PORTALS_BLUE = [
        { c: 0, r: 2, dir: { dc:  0, dr: -1 } }, // UI ( 1, 3):  bar NORTH — blue A
        { c: 8, r: 6, dir: { dc:  0, dr: -1 } }, // UI ( 9, 7):  bar NORTH — blue B
      ];
      const LAYOUT_CHIPS_ESCAPE_PORTALS_RED = [
        { c: 4, r: 0, dir: { dc:  1, dr:  0 } }, // UI ( 5, 1):  bar EAST — red A
        { c: 4, r: 7, dir: { dc:  1, dr:  0 } }, // UI ( 5, 8):  bar EAST — red B
      ];
      const LAYOUT_CHIPS_ESCAPE_PORTALS_GREEN = [
        { c: 2, r: 7, dir: { dc:  1, dr:  0 } }, // UI ( 3, 8):  bar EAST — green A
        { c: 9, r: 8, dir: { dc:  0, dr:  1 } }, // UI (10, 9):  bar SOUTH off-grid — green B
      ];
      const LAYOUT_CHIPS_ESCAPE_TNT = [
        { c: 6, r: 1 }, // UI ( 7, 2)
        { c: 0, r: 4 }, // UI ( 1, 5)
      ];
      const LAYOUT_CHIPS_ESCAPE_LAVA = [
        { c: 3, r: 7 }, // UI ( 4, 8)
        { c: 6, r: 8 }, // UI ( 7, 9)
        { c: 6, r: 9 }, // UI ( 7,10)
      ];
      // Single chest in the top-right — visible from IN but cordoned
      // off by row-1 / row-2 boulders; reaching it requires the red
      // portal pair.
      const LAYOUT_CHIPS_ESCAPE_WEAPONS = [
        { c: 8, r: 0 }, // UI ( 9, 1)
      ];
      const LAYOUT_CHIPS_ESCAPE_CAKES = [
        { c: 6, r: 0 }, // UI ( 7, 1) — tucked between two boulders on the top edge
      ];
      const LAYOUT_CHIPS_ESCAPE_POTIONS = [
        { c: 1, r: 1 }, // UI ( 2, 2)
      ];
      // Two keys: one hidden under a rock at (2,1), one out in the
      // open at (6,6). Two locks: one mid-board at (2,4), one on the
      // OUT cell at (9,9) so reaching the exit requires spending a
      // key in addition to navigating the portal labyrinth.
      const LAYOUT_CHIPS_ESCAPE_KEYS = [
        { c: 2, r: 1 }, // UI ( 3, 2) — under a rock
        { c: 6, r: 6 }, // UI ( 7, 7)
      ];
      const LAYOUT_CHIPS_ESCAPE_LOCKS = [
        { c: 2, r: 4 }, // UI ( 3, 5)
        { c: 9, r: 9 }, // UI (10,10) — OUT itself; spend a key to exit
      ];
      // Five rocks scattered across the grid. (2,1) hides a key;
      // (5,9) sits on top of a spider, between lava cells.
      const LAYOUT_CHIPS_ESCAPE_ROCKS = [
        { c: 2, r: 1 }, // UI ( 3, 2) — also hides a key
        { c: 6, r: 3 }, // UI ( 7, 4)
        { c: 1, r: 4 }, // UI ( 2, 5)
        { c: 6, r: 5 }, // UI ( 7, 6)
        { c: 5, r: 9 }, // UI ( 6,10) — sits on the spider at (5,9)
      ];
      const LAYOUT_CHIPS_ESCAPE_SPIDERS = [
        { c: 6, r: 2 }, // UI ( 7, 3)
        { c: 2, r: 3 }, // UI ( 3, 4)
        { c: 6, r: 7 }, // UI ( 7, 8)
        { c: 5, r: 9 }, // UI ( 6,10) — pinned under the rock at (5,9)
      ];
      // LAYOUT_CAKE_IS_A_LIE ("Cake is a Lie"): hand-placed layout — a
      // portal labyrinth with all four portal colors (purple, yellow,
      // blue, red), an L-shape slide-cake corridor running down the left
      // edge and across row 10, scattered hazards (TnT, lava, knights),
      // a clutch of walls protecting the top-left lava pit, and a single
      // pushable rock on the slide. The grid is mostly walled off with
      // boulders so the player has to chain portal hops to reach OUT in
      // the bottom-right corner.
      // Coords are 0-indexed; UI labels in comments are 1-indexed.
      const LAYOUT_CAKE_IS_A_LIE_SLIDES = [
        { c: 0, r: 1 }, // UI ( 1, 2)
        { c: 0, r: 5 }, // UI ( 1, 6) — also has a cake on top
        { c: 1, r: 9 }, // UI ( 2,10)
        { c: 3, r: 9 }, // UI ( 4,10)
      ];
      const LAYOUT_CAKE_IS_A_LIE_LAVA = [
        { c: 3, r: 1 }, // UI ( 4, 2) — walled in on three sides
        { c: 6, r: 9 }, // UI ( 7,10)
      ];
      const LAYOUT_CAKE_IS_A_LIE_TNT = [
        { c: 9, r: 1 }, // UI (10, 2)
        { c: 0, r: 9 }, // UI ( 1,10)
        { c: 4, r: 9 }, // UI ( 5,10)
      ];
      const LAYOUT_CAKE_IS_A_LIE_KNIGHTS = [
        { c: 6, r: 2 }, // UI ( 7, 3)
        { c: 8, r: 3 }, // UI ( 9, 4)
        { c: 3, r: 7 }, // UI ( 4, 8)
        { c: 8, r: 7 }, // UI ( 9, 8)
        { c: 7, r: 8 }, // UI ( 8, 9)
      ];
      // Wall ring around the top-left lava pit at (3,1). Bars on the
      // outside-facing sides of (2,0)(3,0)(4,0)(2,1)(4,1)(2,2)(4,2)
      // funnel approach to a single opening from the south.
      const LAYOUT_CAKE_IS_A_LIE_WALLS = [
        { c: 2, r: 0, dirs: [{ dc: 0, dr: -1 }, { dc: -1, dr: 0 }] },
        { c: 3, r: 0, dirs: [{ dc: 0, dr: -1 }] },
        { c: 4, r: 0, dirs: [{ dc: 0, dr: -1 }] },
        { c: 2, r: 1, dirs: [{ dc: -1, dr: 0 }] },
        { c: 4, r: 1, dirs: [{ dc:  1, dr:  0 }] },
        { c: 2, r: 2, dirs: [{ dc: 0, dr:  1 }, { dc: -1, dr: 0 }] },
        { c: 4, r: 2, dirs: [{ dc: 0, dr:  1 }, { dc:  1, dr: 0 }] },
      ];
      const LAYOUT_CAKE_IS_A_LIE_BOULDERS = [
        // Top-right cluster (rows 1–3)
        { c: 7, r: 0 }, { c: 8, r: 0 },
        { c: 5, r: 1 }, { c: 8, r: 1 },
        { c: 5, r: 2 }, { c: 8, r: 2 }, { c: 9, r: 2 },
        // Mid band (rows 4–6) — splits the grid into upper / lower halves
        { c: 2, r: 3 }, { c: 4, r: 3 }, { c: 5, r: 3 }, { c: 6, r: 3 }, { c: 7, r: 3 }, { c: 9, r: 3 },
        { c: 2, r: 4 }, { c: 6, r: 4 },
        { c: 2, r: 5 }, { c: 3, r: 5 }, { c: 4, r: 5 }, { c: 5, r: 5 }, { c: 7, r: 5 }, { c: 8, r: 5 }, { c: 9, r: 5 },
        { c: 1, r: 6 }, { c: 5, r: 6 }, { c: 9, r: 6 },
        // Lower band (rows 8–9) — corridors with knights
        { c: 1, r: 7 }, { c: 5, r: 7 }, { c: 7, r: 7 }, { c: 9, r: 7 },
        { c: 1, r: 8 }, { c: 2, r: 8 }, { c: 3, r: 8 }, { c: 4, r: 8 }, { c: 5, r: 8 }, { c: 8, r: 8 }, { c: 9, r: 8 },
        // Row 10 — boulders fill the gaps between the slide / TnT / lava chain
        { c: 5, r: 9 }, { c: 7, r: 9 }, { c: 8, r: 9 },
      ];
      // Four portal pairs — one of each color. Each pair only matches its
      // own color (handled by getPartnerPortal).
      const LAYOUT_CAKE_IS_A_LIE_PORTALS = [          // purple
        { c: 0, r: 3, dir: { dc:  0, dr:  1 } }, // UI ( 1, 4): bar SOUTH — purple A
        { c: 7, r: 4, dir: { dc: -1, dr:  0 } }, // UI ( 8, 5): bar WEST  — purple B
      ];
      const LAYOUT_CAKE_IS_A_LIE_PORTALS_YELLOW = [
        { c: 3, r: 4, dir: { dc:  0, dr:  1 } }, // UI ( 4, 5): bar SOUTH — yellow A
        { c: 9, r: 4, dir: { dc:  1, dr:  0 } }, // UI (10, 5): bar EAST (off-grid) — yellow B
      ];
      const LAYOUT_CAKE_IS_A_LIE_PORTALS_BLUE = [
        { c: 6, r: 5, dir: { dc: -1, dr:  0 } }, // UI ( 7, 6): bar WEST  — blue A
        { c: 2, r: 9, dir: { dc:  0, dr: -1 } }, // UI ( 3,10): bar NORTH — blue B
      ];
      const LAYOUT_CAKE_IS_A_LIE_PORTALS_RED = [
        { c: 6, r: 0, dir: { dc:  0, dr: -1 } }, // UI ( 7, 1): bar NORTH (off-grid) — red A
        { c: 2, r: 6, dir: { dc:  0, dr: -1 } }, // UI ( 3, 7): bar NORTH — red B
      ];
      // Cakes line the left edge below the slide, rewarding the long way
      // down. The cell at (0,5) carries BOTH a slide env AND a cake.
      // Two extras: one immediately east of the slide-cake, and one on OUT.
      const LAYOUT_CAKE_IS_A_LIE_CAKES = [
        { c: 0, r: 5 }, // UI ( 1, 6) — sits on the slide
        { c: 1, r: 5 }, // UI ( 2, 6) — directly east of the slide-cake
        { c: 0, r: 6 }, // UI ( 1, 7)
        { c: 0, r: 7 }, // UI ( 1, 8)
        { c: 0, r: 8 }, // UI ( 1, 9)
        { c: 9, r: 9 }, // UI (10,10) — on OUT
      ];
      // A single pushable rock parked next to the boulder cluster. Players
      // can shove it east into the boulder maze to alter the layout.
      const LAYOUT_CAKE_IS_A_LIE_ROCKS = [
        { c: 1, r: 1 }, // UI ( 2, 2) — sits between the slide and the walled lava pit
      ];

      // LAYOUT_NO_WAY_OUT ("No Way Out"): hand-placed layout — a coiled corridor
      // hemmed in by two horizontal rock walls (rows 2 and 9) plus inner
      // vertical posts and a pair of horizontal segments. OUT sits at
      // (3, 5) hidden under a rock — the player has to weave through
      // the corridor and push that specific rock off OUT to escape.
      // Six TnT cells punish careless paths through the maze.
      // Coords are 0-indexed; UI labels in comments are 1-indexed.
      const LAYOUT_NO_WAY_OUT_OUT = { c: 3, r: 5 }; // UI ( 4, 6) — hidden under a rock
      const LAYOUT_NO_WAY_OUT_TNT = [
        { c: 6, r: 0 }, // UI ( 7, 1)
        { c: 1, r: 2 }, // UI ( 2, 3)
        { c: 2, r: 4 }, // UI ( 3, 5)
        { c: 9, r: 6 }, // UI (10, 7)
        { c: 0, r: 7 }, // UI ( 1, 8)
        { c: 6, r: 7 }, // UI ( 7, 8)
      ];
      const LAYOUT_NO_WAY_OUT_ROCKS = [
        // Row 2: top wall (cols 1–7)
        { c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 }, { c: 4, r: 1 },
        { c: 5, r: 1 }, { c: 6, r: 1 }, { c: 7, r: 1 },
        // Row 3: right post only
        { c: 7, r: 2 },
        // Row 4: inner top-half wall (cols 1–5) + right post
        { c: 1, r: 3 }, { c: 2, r: 3 }, { c: 3, r: 3 }, { c: 4, r: 3 },
        { c: 5, r: 3 },
        { c: 7, r: 3 },
        // Row 5: vertical posts at cols 1, 5, 7
        { c: 1, r: 4 }, { c: 5, r: 4 }, { c: 7, r: 4 },
        // Row 6: vertical posts at cols 1, 3 (OUT under this rock), 5, 7
        { c: 1, r: 5 }, { c: 3, r: 5 }, { c: 5, r: 5 }, { c: 7, r: 5 },
        // Row 7: posts + inner horizontal segment (cols 3–5)
        { c: 1, r: 6 }, { c: 3, r: 6 }, { c: 4, r: 6 }, { c: 5, r: 6 },
        { c: 7, r: 6 },
        // Row 8: vertical posts at cols 1, 7
        { c: 1, r: 7 }, { c: 7, r: 7 },
        // Row 9: bottom wall (cols 1–7)
        { c: 1, r: 8 }, { c: 2, r: 8 }, { c: 3, r: 8 }, { c: 4, r: 8 },
        { c: 5, r: 8 }, { c: 6, r: 8 }, { c: 7, r: 8 },
      ];

      // -----------------------------------------------------------------
      // LAYOUT_LOCKDOWN ("Lockdown!" — hand-authored).
      // The OUT cell at (9, 9) starts locked. Two keys are hidden under
      // rocks; either one unlocks OUT (locks consume 1 key per cell, and
      // there are three lock cells gating the bottom-right corner). Two
      // spiders patrol — one upstairs near the upper rock cluster, one
      // downstairs near the bottom-left rocks.
      // -----------------------------------------------------------------
      const LAYOUT_LOCKDOWN_OUT = { c: 9, r: 9 };
      const LAYOUT_LOCKDOWN_BOULDERS  = [
        { c: 7, r: 7 }, { c: 8, r: 7 }, { c: 7, r: 8 },
      ];
      const LAYOUT_LOCKDOWN_TNT       = [
        { c: 2, r: 0 }, { c: 0, r: 2 },
      ];
      const LAYOUT_LOCKDOWN_ROCKS     = [
        { c: 1, r: 0 }, { c: 0, r: 1 },
        { c: 6, r: 2 }, { c: 6, r: 3 }, { c: 6, r: 4 },
        { c: 1, r: 7 }, { c: 2, r: 7 }, { c: 3, r: 7 },
      ];
      const LAYOUT_LOCKDOWN_KEYS      = [
        { c: 6, r: 4 }, { c: 1, r: 7 },
      ];
      const LAYOUT_LOCKDOWN_LOCKS     = [
        { c: 9, r: 7 }, { c: 7, r: 9 }, { c: 9, r: 9 },
      ];
      const LAYOUT_LOCKDOWN_POTIONS   = [
        { c: 3, r: 0 }, { c: 0, r: 3 },
        // Third potion hides under one of the trees in the mid-board
        // grove (see LAYOUT_LOCKDOWN_TREES) — only revealed when the
        // player steps onto that tree cell.
        { c: 4, r: 5 },
      ];
      const LAYOUT_LOCKDOWN_SPIDERS   = [
        { c: 7, r: 3 }, { c: 2, r: 8 },
      ];
      // Tight 9-tree clump (3×3 block at cols 2–4, rows 3–5) in the
      // mid-board area. Fully symmetric on both axes of its own center
      // at (3, 4), giving the player a square canopy patch for hiding
      // from spiders without walling off the diagonal path from
      // IN (0, 0) to OUT (9, 9). The clump is positioned so that no
      // tree cell is adjacent (4- or 8-neighbor) to any rock. One of
      // these trees (4, 5) hides an Invisibility Potion (see
      // LAYOUT_LOCKDOWN_POTIONS).
      const LAYOUT_LOCKDOWN_TREES     = [
        { c: 2, r: 3 }, { c: 3, r: 3 }, { c: 4, r: 3 },
        { c: 2, r: 4 }, { c: 3, r: 4 }, { c: 4, r: 4 },
        { c: 2, r: 5 }, { c: 3, r: 5 }, { c: 4, r: 5 },
      ];

      // -----------------------------------------------------------------
      // LAYOUT_PORTAL1 ("Portal!" — hand-authored).
      // A boulder-walled labyrinth with all four portal colors.
      // • Purple (portal):     (9,5) ↔ (1,9)         — horizontal pair
      // • Yellow (portal-y):   (0,2) ↔ (1,6)         — vertical pair
      // • Blue   (portal-b):   (1,0) ↔ (9,8)         — mixed-axis pair
      // • Red    (portal-r):   (9,2) ↔ (3,9)         — mixed-axis pair
      // A wall maze gates the central corridor; one spider patrols at
      // (5,4). A knight tile sits at (7,8) as a side-jump shortcut near
      // OUT.
      // -----------------------------------------------------------------
      const LAYOUT_PORTAL1_OUT = { c: 9, r: 9 };
      const LAYOUT_PORTAL1_BOULDERS  = [
        { c: 2, r: 0 }, { c: 3, r: 0 },
        { c: 0, r: 1 }, { c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 },
        { c: 4, r: 1 }, { c: 5, r: 1 }, { c: 6, r: 1 }, { c: 7, r: 1 },
        { c: 8, r: 1 }, { c: 9, r: 1 },
        { c: 0, r: 3 }, { c: 1, r: 3 }, { c: 2, r: 3 },
        { c: 8, r: 3 }, { c: 9, r: 3 },
        { c: 0, r: 4 }, { c: 1, r: 4 }, { c: 2, r: 4 },
        { c: 8, r: 4 }, { c: 9, r: 4 },
        { c: 0, r: 5 }, { c: 1, r: 5 }, { c: 2, r: 5 },
        { c: 8, r: 5 },
        { c: 2, r: 6 }, { c: 8, r: 6 },
        { c: 2, r: 7 }, { c: 6, r: 7 }, { c: 7, r: 7 }, { c: 8, r: 7 },
        { c: 2, r: 8 }, { c: 4, r: 8 }, { c: 8, r: 8 },
        { c: 2, r: 9 }, { c: 4, r: 9 }, { c: 5, r: 9 },
        { c: 6, r: 9 }, { c: 7, r: 9 }, { c: 8, r: 9 },
      ];
      const LAYOUT_PORTAL1_WALLS     = [
        { c: 4, r: 3, dirs: [{ dc: -1, dr: 0 }, { dc: 0, dr: -1 }] },
        { c: 5, r: 3, dirs: [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }] },
        { c: 6, r: 3, dirs: [{ dc: 0, dr: -1 }, { dc: 1, dr: 0 }] },
        { c: 4, r: 4, dirs: [{ dc: -1, dr: 0 }, { dc: 1, dr: 0 }] },
        { c: 6, r: 4, dirs: [{ dc: -1, dr: 0 }, { dc: 1, dr: 0 }] },
        { c: 4, r: 5, dirs: [{ dc: -1, dr: 0 }] },
        { c: 5, r: 5, dirs: [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }] },
        { c: 6, r: 5, dirs: [{ dc: 0, dr: 1 }, { dc: 1, dr: 0 }] },
        { c: 4, r: 6, dirs: [{ dc: -1, dr: 0 }, { dc: 1, dr: 0 }] },
        { c: 4, r: 7, dirs: [{ dc: 0, dr: 1 }, { dc: -1, dr: 0 }, { dc: 1, dr: 0 }] },
      ];
      const LAYOUT_PORTAL1_SLIDES    = [
        { c: 1, r: 2 }, { c: 8, r: 2 },
      ];
      const LAYOUT_PORTAL1_KNIGHTS   = [
        { c: 7, r: 8 },
      ];
      const LAYOUT_PORTAL1_LAVA      = [];
      const LAYOUT_PORTAL1_TNT       = [];
      const LAYOUT_PORTAL1_PORTALS         = [ // purple
        { c: 9, r: 5, dir: { dc:  1, dr:  0 } },
        { c: 1, r: 9, dir: { dc:  0, dr: -1 } },
      ];
      const LAYOUT_PORTAL1_PORTALS_YELLOW  = [
        { c: 0, r: 2, dir: { dc: -1, dr:  0 } },
        { c: 1, r: 6, dir: { dc:  0, dr:  1 } },
      ];
      const LAYOUT_PORTAL1_PORTALS_BLUE    = [
        { c: 1, r: 0, dir: { dc:  1, dr:  0 } },
        { c: 9, r: 8, dir: { dc:  0, dr:  1 } },
      ];
      const LAYOUT_PORTAL1_PORTALS_RED     = [
        { c: 9, r: 2, dir: { dc:  1, dr:  0 } },
        { c: 3, r: 9, dir: { dc:  0, dr:  1 } },
      ];
      const LAYOUT_PORTAL1_ROCKS     = [];
      const LAYOUT_PORTAL1_KEYS      = [];
      const LAYOUT_PORTAL1_LOCKS     = [];
      const LAYOUT_PORTAL1_WEAPONS   = [];
      const LAYOUT_PORTAL1_POTIONS   = [];
      const LAYOUT_PORTAL1_CAKES     = [];
      const LAYOUT_PORTAL1_SPIDERS   = [
        { c: 5, r: 4 },
      ];

      // ── LAYOUT_FORD_THE_RIVER (UI Level 11) ──────────────────────────
      // River-crossing puzzle. The board splits into three bands:
      //   • Rows 1–2 (display): wooded top bank — IN sits in the top
      //     right corner; a single rock at (10, 3) shoves into the river
      //     or onto the east lava strip; a knife chest hides under the
      //     tree next to IN and a cake hides under another tree.
      //   • Rows 4–8 (display): the river itself — a 5-row, 9-wide flow
      //     with mixed directions (south/east elbows + a couple of
      //     westward and northward curls) that funnel toward the east
      //     bank. The east edge of the river (column 10, rows 4–7 in UI)
      //     is lava; drifting into it kills the player. The west edge of
      //     row 7 is TnT for a similar punishment on a westward drift.
      //   • Rows 9–10 (display): south bank. A tree wall on row 10
      //     leaves a single safe step at the OUT cell (4, 10).
      // No spiders, no portals — the river itself is the antagonist.
      const LAYOUT_FORD_THE_RIVER_IN  = { c: 9, r: 0 }; // UI (10, 1)
      const LAYOUT_FORD_THE_RIVER_OUT = { c: 3, r: 9 }; // UI (4, 10)
      const LAYOUT_FORD_THE_RIVER_TREES = [
        // Top bank tree band (row 0 in JS coords / UI row 1). The IN cell
        // at (9, 0) is intentionally omitted — IN/OUT cells render their
        // gate labels regardless of env, so leaving env neutral keeps the
        // visual clean.
        { c: 0, r: 0 }, { c: 1, r: 0 }, { c: 2, r: 0 }, { c: 3, r: 0 },
        { c: 4, r: 0 }, { c: 5, r: 0 }, { c: 6, r: 0 }, { c: 7, r: 0 },
        { c: 8, r: 0 },
        // Sparse row 1 (UI row 2): three sentinel trees that thin the
        // movement options between IN and the riverbank.
        { c: 2, r: 1 }, { c: 5, r: 1 }, { c: 8, r: 1 },
        // Far-bank partial cover (row 8 / UI row 9): three trees that
        // give the player a few hiding spots after crossing.
        { c: 0, r: 8 }, { c: 7, r: 8 }, { c: 9, r: 8 },
        // Far-bank tree wall (row 9 / UI row 10). The single gap at
        // column 3 is the OUT cell.
        { c: 0, r: 9 }, { c: 1, r: 9 }, { c: 2, r: 9 },
                        { c: 4, r: 9 }, { c: 5, r: 9 }, { c: 6, r: 9 },
        { c: 7, r: 9 }, { c: 8, r: 9 }, { c: 9, r: 9 },
      ];
      const LAYOUT_FORD_THE_RIVER_LAVA = [
        // East-edge lava barrier (column 9 / UI column 10, rows 3–6 /
        // UI rows 4–7). Any eastward drift off the river dumps into lava.
        { c: 9, r: 3 }, { c: 9, r: 4 }, { c: 9, r: 5 }, { c: 9, r: 6 },
      ];
      const LAYOUT_FORD_THE_RIVER_TNT = [
        // West-edge demolition at (0, 6) / UI (1, 7). Two leftward river
        // tiles on row 6 funnel a careless drift onto this TnT.
        { c: 0, r: 6 },
      ];
      const LAYOUT_FORD_THE_RIVER_RIVERS = [
        // Row 3 (top of the river, UI row 4): mostly southbound with a
        // pair of eastward elbows at columns 1 and 5/7.
        { c: 0, r: 3, dir: { dc:  0, dr:  1 } },
        { c: 1, r: 3, dir: { dc:  1, dr:  0 } },
        { c: 2, r: 3, dir: { dc:  0, dr:  1 } },
        { c: 3, r: 3, dir: { dc:  0, dr:  1 } },
        { c: 4, r: 3, dir: { dc:  0, dr:  1 } },
        { c: 5, r: 3, dir: { dc:  1, dr:  0 } },
        { c: 6, r: 3, dir: { dc:  0, dr:  1 } },
        { c: 7, r: 3, dir: { dc:  1, dr:  0 } },
        { c: 8, r: 3, dir: { dc:  0, dr:  1 } },
        // Row 4 (UI row 5): a westward backwash at column 2 mixes with
        // east + south flow elsewhere.
        { c: 0, r: 4, dir: { dc:  0, dr:  1 } },
        { c: 1, r: 4, dir: { dc:  0, dr:  1 } },
        { c: 2, r: 4, dir: { dc: -1, dr:  0 } },
        { c: 3, r: 4, dir: { dc:  0, dr:  1 } },
        { c: 4, r: 4, dir: { dc:  1, dr:  0 } },
        { c: 5, r: 4, dir: { dc:  0, dr:  1 } },
        { c: 6, r: 4, dir: { dc:  1, dr:  0 } },
        { c: 7, r: 4, dir: { dc:  1, dr:  0 } },
        { c: 8, r: 4, dir: { dc:  1, dr:  0 } },
        // Row 5 (UI row 6): an east → south sweep that feeds back into
        // the deeper part of the channel.
        { c: 0, r: 5, dir: { dc:  1, dr:  0 } },
        { c: 1, r: 5, dir: { dc:  1, dr:  0 } },
        { c: 2, r: 5, dir: { dc:  0, dr:  1 } },
        { c: 3, r: 5, dir: { dc:  0, dr:  1 } },
        { c: 4, r: 5, dir: { dc:  1, dr:  0 } },
        { c: 5, r: 5, dir: { dc:  1, dr:  0 } },
        { c: 6, r: 5, dir: { dc:  0, dr:  1 } },
        { c: 7, r: 5, dir: { dc:  1, dr:  0 } },
        { c: 8, r: 5, dir: { dc:  1, dr:  0 } },
        // Row 6 (UI row 7, with TnT at column 0): a chaotic mid-river
        // band — westward currents on columns 1–2 are the route to the
        // TnT trap; a northward curl at column 5 sends entities back up.
        { c: 1, r: 6, dir: { dc: -1, dr:  0 } },
        { c: 2, r: 6, dir: { dc: -1, dr:  0 } },
        { c: 3, r: 6, dir: { dc:  1, dr:  0 } },
        { c: 4, r: 6, dir: { dc:  0, dr:  1 } },
        { c: 5, r: 6, dir: { dc:  0, dr: -1 } },
        { c: 6, r: 6, dir: { dc:  1, dr:  0 } },
        { c: 7, r: 6, dir: { dc:  0, dr:  1 } },
        { c: 8, r: 6, dir: { dc:  1, dr:  0 } },
        // Row 7 (UI row 8, bottom of the river): a strong east current
        // along the bank; the column 5/6 cells loop back into the row
        // above so a player can't just ride the bottom edge across.
        { c: 0, r: 7, dir: { dc:  1, dr:  0 } },
        { c: 1, r: 7, dir: { dc:  1, dr:  0 } },
        { c: 2, r: 7, dir: { dc:  1, dr:  0 } },
        { c: 3, r: 7, dir: { dc:  1, dr:  0 } },
        { c: 4, r: 7, dir: { dc:  1, dr:  0 } },
        { c: 5, r: 7, dir: { dc:  0, dr:  1 } },
        { c: 6, r: 7, dir: { dc:  0, dr: -1 } },
        { c: 7, r: 7, dir: { dc:  1, dr:  0 } },
        { c: 8, r: 7, dir: { dc:  1, dr:  0 } },
      ];
      const LAYOUT_FORD_THE_RIVER_CAKES = [
        { c: 6, r: 0 }, // UI (7, 1)  — cake hidden under a tree on the top bank
        { c: 9, r: 7 }, // UI (10, 8) — east-bank prize between the lava strip and the OUT row
      ];
      const LAYOUT_FORD_THE_RIVER_WEAPONS = [
        { c: 8, r: 0 }, // UI (9, 1) — knife chest hidden under a tree next to IN
      ];
      const LAYOUT_FORD_THE_RIVER_ROCKS = [
        { c: 9, r: 2 }, // UI (10, 3) — pushable rock one cell south of IN; player can shove it into the river or onto the east lava strip
      ];

      // ── LAYOUT_ORDERED_ESCAPE (UI Level 12) ──────────────────────────
      // Multi-room ordered puzzle. The board has three chambers walled
      // off from one another, plus a green-portal shortcut down the
      // west edge:
      //
      //   • Top-left "key room" (cols 0–3, rows 0–4): contains the West
      //     Button at UI (3, 4) and a starter rock at UI (3, 3) that
      //     shoves south onto it. That button holds open the Lock at
      //     UI (7, 2) that blocks the entrance to the top-right room.
      //
      //   • Top-right "lock + vault" room (cols 6–9, rows 0–4): the
      //     North Button at UI (8, 1) flips the Red Portal at UI (7, 6)
      //     into a Yellow Portal while pressed. A free rock at UI (6,
      //     2) sits just outside the lock entrance and can be shoved
      //     onto the North Button to hold it down. A second rock at
      //     UI (9, 5) can be pushed west into the river at UI (8, 4);
      //     the river carries it south then west to rest on the portal
      //     at UI (7, 6). Lava strip at UI (9, 4) borders the river.
      //
      //   • Bottom escape: a Yellow Portal at UI (1, 10) sits below
      //     OUT at UI (10, 10). It only pairs with anything once the
      //     North Button virtually flips the Red Portal at UI (7, 6)
      //     to yellow, opening a teleport route from the river-end to
      //     the OUT-flanking yellow.
      //
      //   • Green-portal shortcut (NEW): a Green Portal at UI (1, 7)
      //     pairs with a Green Portal at UI (9, 10). Walking SOUTH off
      //     the top one teleports you to the bottom one, popping out
      //     WEST right next to OUT — a fast bypass around the southern
      //     terrain. A south-facing wall at UI (1, 6) gates entry from
      //     the north so you can't accidentally enter from the key
      //     room's western edge.
      //
      // Additional terrain: a Green Knight at UI (3, 7), TnT at UI (1, 8)
      // and UI (6, 6), and a tree grove at UI (5,8)/(6,8)/(5,9)/(6,9)
      // separates the southern half. A spare rock at UI (3, 9) lets
      // the player experiment in the bottom-left area.
      //
      // Authored in the Save-layout JSON shape so the entry just hands
      // the data off to applyCustomLevel. Keep this in sync with the
      // in-game editor's schema (cells / inCell / outCell / buttons).
      const LAYOUT_ORDERED_ESCAPE = {
        inCell: { c: 0, r: 0 },
        outCell: { c: 9, r: 9 },
        cells: [
          // ─── Row 0 ─── top wall fragments framing the lock-room entrance.
          { c: 6, r: 0, env: 'wall', wallDirs: [{ dc: -1, dr: 0 }] },                      // UI (7, 1) — west wall closes the gap left of the North Button.
          { c: 7, r: 0, env: 'button' },                                                   // UI (8, 1) — North Button: flips Red Portal (7, 6) → Yellow while pressed.

          // ─── Row 1 ─── key-room top wall + free rock + lock-room entrance lock + east portal.
          { c: 1, r: 1, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }, { dc: -1, dr: 0 }] },   // UI (2, 2) — NW corner of key room.
          { c: 3, r: 1, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }, { dc: 1, dr: 0 }] },    // UI (4, 2) — NE corner of key room.
          { c: 5, r: 1, rock: true },                                                      // UI (6, 2) — free rock just west of the lock; pushable onto the North Button.
          { c: 6, r: 1, lock: true },                                                      // UI (7, 2) — the Lock the West Button opens.
          { c: 9, r: 1, env: 'portal-r', portalDirs: { dc: 1, dr: 0 } },                   // UI (10, 2) — Red Portal A (bar east, partner of (6, 5)).

          // ─── Row 2 ─── key-room interior + starter rock + lock-room south wall.
          { c: 1, r: 2, env: 'wall', wallDirs: [{ dc: -1, dr: 0 }] },                      // UI (2, 3) — west wall of key room.
          { c: 2, r: 2, rock: true },                                                      // UI (3, 3) — starter rock; player enters from (2, 1) and shoves south onto the West Button at (2, 3).
          { c: 3, r: 2, env: 'wall', wallDirs: [{ dc: 1, dr: 0 }] },                       // UI (4, 3) — east wall of key room.
          { c: 6, r: 2, env: 'wall', wallDirs: [{ dc: -1, dr: 0 }, { dc: 0, dr: 1 }] },    // UI (7, 3) — SW corner of vault.
          { c: 7, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },                       // UI (8, 3) — south wall of vault.
          { c: 8, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },                       // UI (9, 3) — south wall of vault.
          { c: 9, r: 2, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },                       // UI (10, 3) — south wall of vault (SE corner).

          // ─── Row 3 ─── key-room button row + start of river.
          { c: 1, r: 3, env: 'wall', wallDirs: [{ dc: -1, dr: 0 }] },                      // UI (2, 4) — west wall of key room.
          { c: 2, r: 3, env: 'button' },                                                   // UI (3, 4) — West Button: holds Lock (6, 1) open while pressed.
          { c: 3, r: 3, env: 'wall', wallDirs: [{ dc: 1, dr: 0 }] },                       // UI (4, 4) — east wall of key room.
          { c: 6, r: 3, env: 'river', riverDirs: { dc: 1, dr: 0 } },                       // UI (7, 4) — river flows east.
          { c: 7, r: 3, env: 'river', riverDirs: { dc: 1, dr: 0 } },                       // UI (8, 4) — river flows east.
          { c: 8, r: 3, env: 'lava' },                                                     // UI (9, 4) — lava strip at the east end of the river.

          // ─── Row 4 ─── key-room south wall + river bend + rock + east wall.
          { c: 1, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }, { dc: -1, dr: 0 }] },    // UI (2, 5) — SW corner of key room.
          { c: 2, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },                       // UI (3, 5) — south wall of key room.
          { c: 3, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }, { dc: 1, dr: 0 }] },     // UI (4, 5) — SE corner of key room.
          { c: 6, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }, { dc: -1, dr: 0 }] },   // UI (7, 5) — NW corner of river chamber.
          { c: 7, r: 4, env: 'river', riverDirs: { dc: 0, dr: 1 } },                       // UI (8, 5) — river bends south.
          { c: 8, r: 4, rock: true },                                                      // UI (9, 5) — the puzzle rock; shove west into the river.
          { c: 9, r: 4, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },                      // UI (10, 5) — north wall closing the vault row.

          // ─── Row 5 ─── west-edge gate + TnT + Red Portal B at the river's end.
          { c: 0, r: 5, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },                       // UI (1, 6) — south wall above the green portal, gates entry from the key-room side.
          { c: 5, r: 5, env: 'tnt' },                                                      // UI (6, 6) — TnT just west of the portal; rock-shove deterrent.
          { c: 6, r: 5, env: 'portal-r', portalDirs: { dc: -1, dr: 0 } },                  // UI (7, 6) — Red Portal B (bar west, partner of (9, 1)).
          { c: 7, r: 5, env: 'river', riverDirs: { dc: -1, dr: 0 } },                      // UI (8, 6) — river bends west onto the portal.

          // ─── Row 6 ─── green portal entrance + green knight + south wall of river chamber.
          { c: 0, r: 6, env: 'portal-g', portalDirs: { dc: 0, dr: 1 } },                   // UI (1, 7) — Green Portal A (bar south, partner of (8, 9)).
          { c: 1, r: 6, env: 'wall', wallDirs: [{ dc: -1, dr: 0 }] },                      // UI (2, 7) — east wall sealing the green-portal alcove.
          { c: 2, r: 6, env: 'green-knight' },                                             // UI (3, 7) — Green Knight (2-fwd + 1-left jump).
          { c: 6, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }, { dc: -1, dr: 0 }] },    // UI (7, 7) — SW corner of river chamber.
          { c: 7, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },                       // UI (8, 7) — south wall of river chamber.
          { c: 8, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },                       // UI (9, 7) — south wall of river chamber.
          { c: 9, r: 6, env: 'wall', wallDirs: [{ dc: 0, dr: 1 }] },                       // UI (10, 7) — south wall of river chamber.

          // ─── Row 7 ─── TnT corner + tree grove starts.
          { c: 0, r: 7, env: 'tnt' },                                                      // UI (1, 8) — corner TnT.
          { c: 1, r: 7, env: 'wall', wallDirs: [{ dc: -1, dr: 0 }] },                      // UI (2, 8) — east wall of TnT alcove.
          { c: 4, r: 7, env: 'tree' },                                                     // UI (5, 8) — tree.
          { c: 5, r: 7, env: 'tree' },                                                     // UI (6, 8) — tree.

          // ─── Row 8 ─── spare rock + tree grove continues + exit-room walls.
          { c: 1, r: 8, env: 'wall', wallDirs: [{ dc: -1, dr: 0 }] },                      // UI (2, 9) — east wall.
          { c: 2, r: 8, rock: true },                                                      // UI (3, 9) — spare rock.
          { c: 4, r: 8, env: 'tree' },                                                     // UI (5, 9) — tree.
          { c: 5, r: 8, env: 'tree' },                                                     // UI (6, 9) — tree.
          { c: 8, r: 8, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }, { dc: -1, dr: 0 }] },   // UI (9, 9) — NW corner of OUT alcove.
          { c: 9, r: 8, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }] },                      // UI (10, 9) — north wall of OUT alcove.

          // ─── Row 9 ─── Yellow Portal + Green Portal flanking the exit.
          { c: 0, r: 9, env: 'portal-y', portalDirs: { dc: 0, dr: 1 } },                   // UI (1, 10) — Yellow Portal (bar south). Orphan until the North Button flips (7, 6) to yellow.
          { c: 1, r: 9, env: 'wall', wallDirs: [{ dc: -1, dr: 0 }] },                      // UI (2, 10) — east wall of yellow alcove.
          { c: 7, r: 9, env: 'wall', wallDirs: [{ dc: 0, dr: -1 }, { dc: -1, dr: 0 }] },   // UI (8, 10) — NW corner of green-portal alcove.
          { c: 8, r: 9, env: 'portal-g', portalDirs: { dc: -1, dr: 0 } },                  // UI (9, 10) — Green Portal B (bar west, partner of (0, 6)). Pops the player out west right next to OUT.
        ],
        buttons: [
          // North Button (UI 8, 1) → flips Red Portal (UI 7, 6) into a
          // Yellow Portal while held. effectivePortalKey reads this on
          // the fly so partner-matching + bar rendering update live.
          // Pressing this lets the river-carried rock teleport via the
          // yellow network to one of the OUT-flanking yellow portals.
          { c: 7, r: 0, targets: [{ c: 6, r: 5 }] },
          // West Button (UI 3, 4) → holds open the Lock at UI (7, 2)
          // (the entrance to the top-right vault room). A rock parked
          // on the button via the starter shove at UI (3, 3) keeps the
          // lock open indefinitely.
          { c: 2, r: 3, targets: [{ c: 6, r: 1 }] },
        ],
      };

      // ── LAYOUT_PET_THE_SPIDERS (UI Level 14, bonus) ─────────────────
      // Post-victory "petting zoo": spiders are friendly and ignore the
      // player; they march to IN and despawn. Player + spider may share
      // any cell. With no knife → pet for +100 (green hearts). With a
      // knife → accidentally hurt the spider for −100 (red toast).
      // Only accessible after the player clears Ordered Escape
      // (campaign final); see STORAGE_KEY_PETTING_ZOO_UNLOCKED.
      const LAYOUT_PET_THE_SPIDERS_OUT = { c: 9, r: 9 };  // UI (10, 10)
      // Heart-shaped spider arrangement (45 cells). IN defaults to
      // (0, 0) and OUT sits at (9, 9), forming a diagonal route the
      // player must thread between the two lobes of the heart. Every
      // spider is friendly and marches toward IN — petting one
      // (bare hands) awards +100; carrying a knife at contact is
      // an accident (−100, clamped at the level's running floor).
      const LAYOUT_PET_THE_SPIDERS_SPIDERS = [
        { c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 },
        { c: 6, r: 1 }, { c: 7, r: 1 }, { c: 8, r: 1 },
        { c: 0, r: 2 }, { c: 1, r: 2 }, { c: 2, r: 2 }, { c: 3, r: 2 },
        { c: 4, r: 2 }, { c: 5, r: 2 }, { c: 6, r: 2 }, { c: 7, r: 2 },
        { c: 8, r: 2 }, { c: 9, r: 2 },
        { c: 0, r: 3 }, { c: 1, r: 3 }, { c: 4, r: 3 }, { c: 5, r: 3 },
        { c: 6, r: 3 }, { c: 8, r: 3 }, { c: 9, r: 3 },
        { c: 0, r: 4 }, { c: 1, r: 4 }, { c: 5, r: 4 },
        { c: 8, r: 4 }, { c: 9, r: 4 },
        { c: 0, r: 5 }, { c: 1, r: 5 }, { c: 8, r: 5 }, { c: 9, r: 5 },
        { c: 1, r: 6 }, { c: 2, r: 6 }, { c: 7, r: 6 }, { c: 8, r: 6 },
        { c: 2, r: 7 }, { c: 3, r: 7 }, { c: 6, r: 7 }, { c: 7, r: 7 },
        { c: 3, r: 8 }, { c: 4, r: 8 }, { c: 5, r: 8 }, { c: 6, r: 8 },
        { c: 4, r: 9 }, { c: 5, r: 9 },
      ];
      // No knife chests in the petting-zoo layout — the player walks
      // through bare-handed, so every spider contact is a +100 pet.
      const LAYOUT_PET_THE_SPIDERS_WEAPONS = [];

      // Total levels played: 0..MAX_LEVEL-1. Reaching OUT on the final level
      // ends the game. `let` (not `const`) because the Save-layout tool can
      // append new levels beyond the original 12; MAX_LEVEL bumps to one
      // past the highest custom-saved level.
      let MAX_LEVEL = 14;
      // Named slot constants so the final-level / unlock / FX logic can
      // branch on identity instead of index arithmetic. SANDBOX is the
      // current "final" slot for game-over purposes (clearing it shows
      // the final game-over card); PETTING_ZOO is the post-win bonus.
      const CAMPAIGN_FINAL_LEVEL_INDEX = 11; // Ordered Escape — fires YOU WON modal
      const SANDBOX_LEVEL_INDEX = 12;
      const PETTING_ZOO_LEVEL_INDEX = 13;
      // Local-storage key for user-saved layouts. customLevels is keyed by
      // level number and stores a sparse snapshot of the grid (see
      // captureCustomSnapshotFromState / applyCustomLevel).
      const STORAGE_KEY_CUSTOM_LEVELS = 'spiders3-custom-levels';
      // Local-storage flag — flipped to '1' the first time the player
      // clears Ordered Escape (LEVEL_ORDER index 11). The EDIT MODE
      // sidebar card stays hidden until this flag is set, so first-time
      // players don't see editor-mode UI before they've finished the
      // built-in campaign.
      const STORAGE_KEY_EDITOR_UNLOCKED = 'spiders3-editor-unlocked';
      function isEditorUnlocked() {
        try { return localStorage.getItem(STORAGE_KEY_EDITOR_UNLOCKED) === '1'; }
        catch (e) { return false; }
      }
      function unlockEditor() {
        try { localStorage.setItem(STORAGE_KEY_EDITOR_UNLOCKED, '1'); } catch (e) {}
        applyEditorUnlockedUI();
      }
      function applyEditorUnlockedUI() {
        const card = document.getElementById('edit-launch-card');
        if (card) card.classList.toggle('hidden', !isEditorUnlocked());
      }
      // Local-storage flag — flipped to '1' the first time the player
      // clears Ordered Escape (CAMPAIGN_FINAL_LEVEL_INDEX). Unlocks the
      // bonus level 14 "Petting Zoo" so its jump button appears in the
      // level-jump row. Survives reloads.
      const STORAGE_KEY_PETTING_ZOO_UNLOCKED = 'spiders3-petting-zoo-unlocked';
      function isPettingZooUnlocked() {
        try { return localStorage.getItem(STORAGE_KEY_PETTING_ZOO_UNLOCKED) === '1'; }
        catch (e) { return false; }
      }
      function unlockPettingZoo() {
        try { localStorage.setItem(STORAGE_KEY_PETTING_ZOO_UNLOCKED, '1'); } catch (e) {}
        // Rebuild the jump-button row so the newly-unlocked level 14
        // chip appears immediately (without a page refresh).
        try { rebuildLevelJumpButtons(); } catch (e) {}
      }
      // Returns true on the petting-zoo bonus level. Pet/ouch/no-aggro
      // rules + pink-spider styling + score floor all gate on this.
      function isPettingZooLevel() {
        return state && state.level === PETTING_ZOO_LEVEL_INDEX;
      }

      // ── LEVEL_ORDER: source of truth for level progression ────────────
      // Each entry is a self-contained level descriptor. Reordering this
      // array is the ONLY thing needed to swap slot positions — names,
      // BFS bailout, corridor mode, and level-jump pad ordering all
      // derive from this list. The LAYOUT_* data constants above are
      // referenced by id, so renaming a slot doesn't require renumbering
      // them.
      //
      // Per-layout fields:
      //   id          — stable string identifier (debugging only).
      //   name        — display name shown in the Turn card.
      //   features    — vestigial metadata: used to be consumed by
      //                 FEATURE_FIRST_LEVEL (now retired). Kept as a
      //                 quick visual annotation of what each level
      //                 introduces; not read by any code path.
      //   corridor    — true → board collapses to the top 3 rows
      //                 (body.corridor-mode + playableRows() === 3). Used
      //                 by the hallway tutorial layout.
      //   complexBfs  — true → BFS solver gives up and shows '?' for
      //                 minTurnsToOut (rocks + locks + portals can blow
      //                 up the search space on the main thread).
      //   apply(ctx)  — materializes the layout. ctx provides {state,
      //                 IN_CELL, OUT_CELL, applyEnvList, applyWallList,
      //                 applyPortalList, applyRiverList, markCells,
      //                 spawnSpidersFrom}.
      const LEVEL_ORDER = [
        {
          id: 'hallway',
          name: 'Hallway',
          features: [],
          corridor: true,
          complexBfs: false,
          apply({ state, OUT_CELL, applyEnvList, markCells, spawnSpidersFrom }) {
            // Tutorial corridor: rows 0..2 only (CSS hides the rest).
            // Boulder maze through the top strip; two cakes; OUT in
            // the bottom-right of the visible 3-row band.
            OUT_CELL.c = LAYOUT_HALLWAY_OUT.c;
            OUT_CELL.r = LAYOUT_HALLWAY_OUT.r;
            applyEnvList('boulder', LAYOUT_HALLWAY_BOULDERS);
            markCells(state.cakes, LAYOUT_HALLWAY_CAKES);
            spawnSpidersFrom(LAYOUT_HALLWAY_SPIDERS);
          },
        },
        {
          id: 'spider-love',
          name: 'Spider Love',
          features: ['spider', 'chest'],
          corridor: false,
          complexBfs: false,
          apply({ state, applyEnvList, markCells, spawnSpidersFrom }) {
            // No env effects, no random items — just a small pack of
            // spiders and four weapons in the center of the grid.
            // Place weapons BEFORE spawning spiders so they avoid the
            // center cells.
            markCells(state.weapons, LAYOUT_SPIDER_LOVE_WEAPON_CELLS);
            applyEnvList('boulder', LAYOUT_SPIDER_LOVE_BOULDERS);
            spawnSpidersFrom(LAYOUT_SPIDER_LOVE_SPIDER_CELLS);
            // Scripted opening move so the two closest spiders meet on
            // turn 1 to demo love mode. spider[0] holds, spider[1]
            // walks one step west onto spider[0]'s cell.
            if (state.spiders[0]) state.spiders[0].scriptedMove = null;
            if (state.spiders[1]) state.spiders[1].scriptedMove = { c: 0, r: 6 };
            markCells(state.cakes, LAYOUT_SPIDER_LOVE_CAKE_CELLS);
          },
        },
        {
          id: 'horse-play',
          name: 'Horse Play',
          // Introduces both knight variants and TnT. The `features`
          // field is vestigial metadata; see LEVEL_ORDER doc above.
          features: ['knight', 'green-knight', 'tnt'],
          corridor: false,
          complexBfs: false,
          apply() {
            // Layout is stored as a Save-layout-shape snapshot above,
            // so we just hand it to the shared applyCustomLevel writer
            // and let it materialize env / walls / items / IN / OUT.
            applyCustomLevel(LAYOUT_HORSE_PLAY);
          },
        },
        {
          id: 'hoppity-hop',
          name: 'Hoppity Hop',
          features: ['knight'],
          corridor: false,
          complexBfs: false,
          apply({ state, applyEnvList, applyWallList, markCells, spawnSpidersFrom }) {
            // Hand-placed 3x3 walled cavern with knights — one inside
            // the cavern (center), four just outside each cardinal
            // edge of the wall ring, and one extra near IN. Treasure
            // chests at the cavern corners (Invisibility Potions NW+SE,
            // Spider Knives NE+SW) are only reachable via the inner
            // knight's L-jump. A cake near OUT rewards a small detour.
            applyWallList(LAYOUT_KNIGHT_VAULT_WALLS);
            applyEnvList('knight', LAYOUT_KNIGHT_VAULT_KNIGHTS);
            markCells(state.potions, LAYOUT_KNIGHT_VAULT_POTION_CELLS);
            markCells(state.weapons, LAYOUT_KNIGHT_VAULT_WEAPON_CELLS);
            markCells(state.cakes, LAYOUT_KNIGHT_VAULT_CAKE_CELLS);
            spawnSpidersFrom(LAYOUT_KNIGHT_VAULT_SPIDER_CELLS);
          },
        },
        {
          id: 'portal',
          name: 'Portal!',
          features: [],
          corridor: false,
          complexBfs: true,
          apply({ state, OUT_CELL, applyEnvList, applyWallList, applyPortalList, markCells, spawnSpidersFrom }) {
            // Hand-authored portal+wall+key+lock layout with a
            // patrolling spider. A wall maze gates the central
            // corridor; rocks/keys/locks empty in current data.
            // Data lives in LAYOUT_PORTAL1_* constants; this apply
            // function just materializes them in order.
            state.spiders = [];
            if (LAYOUT_PORTAL1_OUT && typeof LAYOUT_PORTAL1_OUT.c === 'number') {
              OUT_CELL.c = LAYOUT_PORTAL1_OUT.c;
              OUT_CELL.r = LAYOUT_PORTAL1_OUT.r;
            }
            applyEnvList('boulder', LAYOUT_PORTAL1_BOULDERS);
            applyWallList(LAYOUT_PORTAL1_WALLS);
            applyEnvList('slide', LAYOUT_PORTAL1_SLIDES);
            applyEnvList('knight', LAYOUT_PORTAL1_KNIGHTS);
            applyEnvList('lava', LAYOUT_PORTAL1_LAVA);
            applyEnvList('tnt', LAYOUT_PORTAL1_TNT);
            applyPortalList('portal',   LAYOUT_PORTAL1_PORTALS);
            applyPortalList('portal-y', LAYOUT_PORTAL1_PORTALS_YELLOW);
            applyPortalList('portal-b', LAYOUT_PORTAL1_PORTALS_BLUE);
            applyPortalList('portal-r', LAYOUT_PORTAL1_PORTALS_RED);
            markCells(state.rocks, LAYOUT_PORTAL1_ROCKS);
            markCells(state.keys, LAYOUT_PORTAL1_KEYS);
            markCells(state.locks, LAYOUT_PORTAL1_LOCKS);
            markCells(state.weapons, LAYOUT_PORTAL1_WEAPONS);
            markCells(state.potions, LAYOUT_PORTAL1_POTIONS);
            markCells(state.cakes, LAYOUT_PORTAL1_CAKES);
            spawnSpidersFrom(LAYOUT_PORTAL1_SPIDERS);
          },
        },
        {
          id: 'danger',
          name: 'DANGER!!',
          features: ['tnt', 'lava'],
          corridor: false,
          complexBfs: false,
          apply({ state, applyEnvList, markCells }) {
            // Hazard-soaked minefield. Roughly half the grid is TnT, a
            // quarter is lava, plus spiders, three weapon chests, and
            // one cake. Two spiders open with scripted moves into
            // adjacent TnT for an immediate "what TnT does" demo.
            applyEnvList('tnt',  LAYOUT_DANGER_TNT);
            applyEnvList('lava', LAYOUT_DANGER_LAVA);
            markCells(state.weapons, LAYOUT_DANGER_WEAPONS);
            markCells(state.cakes,   LAYOUT_DANGER_CAKES);
            // Build spider list by hand so we can attach firstMoveDir
            // to the two flagged opening-move spiders.
            state.spiders = LAYOUT_DANGER_SPIDERS.map((s) => {
              const sp = {
                c: s.c, r: s.r,
                alive: true,
                isBaby: false,
                babyTurnsLeft: 0,
                justBorn: false,
              };
              if (s.firstMoveDir) sp.firstMoveDir = { ...s.firstMoveDir };
              return sp;
            });
          },
        },
        {
          id: 'lockdown',
          name: 'Lockdown!',
          features: ['rock'],
          corridor: false,
          complexBfs: true,
          apply({ state, OUT_CELL, applyEnvList, markCells, spawnSpidersFrom }) {
            // OUT starts locked behind a key-gated corner. Two rocks
            // hide keys; the player has to push the right rocks off,
            // pick up a key, and walk it to OUT to unlock the gate.
            // Two spiders patrol opposite halves of the board. Data
            // lives in LAYOUT_LOCKDOWN_*.
            state.spiders = [];
            if (LAYOUT_LOCKDOWN_OUT && typeof LAYOUT_LOCKDOWN_OUT.c === 'number') {
              OUT_CELL.c = LAYOUT_LOCKDOWN_OUT.c;
              OUT_CELL.r = LAYOUT_LOCKDOWN_OUT.r;
            }
            applyEnvList('boulder', LAYOUT_LOCKDOWN_BOULDERS);
            applyEnvList('tnt', LAYOUT_LOCKDOWN_TNT);
            applyEnvList('tree', LAYOUT_LOCKDOWN_TREES);
            markCells(state.rocks, LAYOUT_LOCKDOWN_ROCKS);
            markCells(state.keys, LAYOUT_LOCKDOWN_KEYS);
            markCells(state.locks, LAYOUT_LOCKDOWN_LOCKS);
            markCells(state.potions, LAYOUT_LOCKDOWN_POTIONS);
            spawnSpidersFrom(LAYOUT_LOCKDOWN_SPIDERS);
          },
        },
        {
          id: 'chips-escape',
          name: "Chip's Escape",
          features: ['slide'],
          corridor: false,
          complexBfs: false,
          apply({ state, applyEnvList, applyPortalList, markCells, spawnSpidersFrom }) {
            // Portal labyrinth dotted with hazards, treasure, and
            // patrolling spiders. Boulders carve the grid into a
            // serpentine maze; five portal pairs (purple, yellow,
            // blue, red, green), a single west-wall slide, scattered
            // rocks/keys/locks, two TnT cells, and three lava cells
            // give the player multiple puzzle beats between IN and
            // OUT. See LAYOUT_CHIPS_ESCAPE_* declarations above for
            // the cell-by-cell breakdown.
            applyEnvList('boulder', LAYOUT_CHIPS_ESCAPE_BOULDERS);
            applyEnvList('slide',   LAYOUT_CHIPS_ESCAPE_SLIDES);
            applyEnvList('tnt',     LAYOUT_CHIPS_ESCAPE_TNT);
            applyEnvList('lava',    LAYOUT_CHIPS_ESCAPE_LAVA);
            applyPortalList('portal',   LAYOUT_CHIPS_ESCAPE_PORTALS);
            applyPortalList('portal-y', LAYOUT_CHIPS_ESCAPE_PORTALS_YELLOW);
            applyPortalList('portal-b', LAYOUT_CHIPS_ESCAPE_PORTALS_BLUE);
            applyPortalList('portal-r', LAYOUT_CHIPS_ESCAPE_PORTALS_RED);
            applyPortalList('portal-g', LAYOUT_CHIPS_ESCAPE_PORTALS_GREEN);
            markCells(state.weapons, LAYOUT_CHIPS_ESCAPE_WEAPONS);
            markCells(state.cakes,   LAYOUT_CHIPS_ESCAPE_CAKES);
            markCells(state.potions, LAYOUT_CHIPS_ESCAPE_POTIONS);
            markCells(state.keys,    LAYOUT_CHIPS_ESCAPE_KEYS);
            markCells(state.locks,   LAYOUT_CHIPS_ESCAPE_LOCKS);
            markCells(state.rocks,   LAYOUT_CHIPS_ESCAPE_ROCKS);
            spawnSpidersFrom(LAYOUT_CHIPS_ESCAPE_SPIDERS);
          },
        },
        {
          id: 'no-way-out',
          name: 'No Way Out',
          features: [],
          corridor: false,
          complexBfs: true,
          // OUT is hidden under a rock on this level — the visible OUT
          // arrow on the side of the grid would give that hiding spot
          // away as a clue, so suppress it. updateInOutArrows() honors
          // this flag and skips the placeEdgeArrow call for OUT.
          hideOutArrow: true,
          apply({ state, OUT_CELL, applyEnvList, markCells }) {
            // Coiled rock-corridor maze. Two horizontal walls (rows 2
            // and 9) bracket the playfield; inside, vertical posts and
            // inner segments form a serpentine path. OUT is hidden
            // under a rock — push it off OUT to exit. Six TnT cells
            // punish careless paths. Data: LAYOUT_NO_WAY_OUT_*.
            state.spiders = [];
            applyEnvList('tnt', LAYOUT_NO_WAY_OUT_TNT);
            markCells(state.rocks, LAYOUT_NO_WAY_OUT_ROCKS);
            OUT_CELL.c = LAYOUT_NO_WAY_OUT_OUT.c;
            OUT_CELL.r = LAYOUT_NO_WAY_OUT_OUT.r;
          },
        },
        {
          // id stays 'finale' for backward compatibility with any saved
          // localStorage keys / level pointers. The display name is the
          // canonical 'Cake is a Lie' for the level banner.
          id: 'finale',
          name: 'Cake is a Lie',
          features: [],
          corridor: false,
          complexBfs: true,
          apply({ state, applyEnvList, applyWallList, applyPortalList, markCells }) {
            // Portal labyrinth with all four portal colors. Boulders
            // wall off most of the grid, leaving an L-shape slide-cake
            // corridor down the left edge and across row 10. Hazards
            // (TnT, lava, knights) scatter through the corridors; a
            // single pushable rock sits on the slide at (1, 5).
            // Players chain portal hops to reach OUT. Data: LAYOUT_CAKE_IS_A_LIE_*.
            applyEnvList('slide',   LAYOUT_CAKE_IS_A_LIE_SLIDES);
            applyEnvList('lava',    LAYOUT_CAKE_IS_A_LIE_LAVA);
            applyEnvList('tnt',     LAYOUT_CAKE_IS_A_LIE_TNT);
            applyEnvList('knight',  LAYOUT_CAKE_IS_A_LIE_KNIGHTS);
            applyEnvList('boulder', LAYOUT_CAKE_IS_A_LIE_BOULDERS);
            applyWallList(LAYOUT_CAKE_IS_A_LIE_WALLS);
            applyPortalList('portal',   LAYOUT_CAKE_IS_A_LIE_PORTALS);
            applyPortalList('portal-y', LAYOUT_CAKE_IS_A_LIE_PORTALS_YELLOW);
            applyPortalList('portal-b', LAYOUT_CAKE_IS_A_LIE_PORTALS_BLUE);
            applyPortalList('portal-r', LAYOUT_CAKE_IS_A_LIE_PORTALS_RED);
            markCells(state.cakes, LAYOUT_CAKE_IS_A_LIE_CAKES);
            markCells(state.rocks, LAYOUT_CAKE_IS_A_LIE_ROCKS);
          },
        },
        {
          id: 'ford-the-river',
          name: 'Ford the River',
          features: [],
          corridor: false,
          // River chain + rock-push-into-lava interactions are expensive
          // to BFS over, so bail out and show '?' for minTurnsToOut.
          complexBfs: true,
          apply({ state, IN_CELL, OUT_CELL, applyEnvList, applyRiverList, markCells }) {
            // Cross the river: IN sits in the top-right corner, OUT in
            // the bottom-left bank. Between them, a 5-row river with
            // mixed currents funnels entities east into a lava strip; a
            // west-edge TnT punishes a backward drift on row 7. Trees
            // on rows 1, 2, 9, and 10 (UI) tighten the safe corridors
            // and hide a knife + two cakes. A single rock by IN can be
            // pushed into the river or onto lava to fill it as a
            // boulder. No spiders — the current is the antagonist.
            // Data: LAYOUT_FORD_THE_RIVER_*.
            state.spiders = [];
            IN_CELL.c  = LAYOUT_FORD_THE_RIVER_IN.c;
            IN_CELL.r  = LAYOUT_FORD_THE_RIVER_IN.r;
            OUT_CELL.c = LAYOUT_FORD_THE_RIVER_OUT.c;
            OUT_CELL.r = LAYOUT_FORD_THE_RIVER_OUT.r;
            applyEnvList('tree', LAYOUT_FORD_THE_RIVER_TREES);
            applyEnvList('lava', LAYOUT_FORD_THE_RIVER_LAVA);
            applyEnvList('tnt',  LAYOUT_FORD_THE_RIVER_TNT);
            applyRiverList(LAYOUT_FORD_THE_RIVER_RIVERS);
            markCells(state.cakes,   LAYOUT_FORD_THE_RIVER_CAKES);
            markCells(state.weapons, LAYOUT_FORD_THE_RIVER_WEAPONS);
            markCells(state.rocks,   LAYOUT_FORD_THE_RIVER_ROCKS);
          },
        },
        {
          id: 'ordered-escape',
          name: 'Ordered Escape',
          features: [],
          corridor: false,
          // Buttons + locks + portals + rocks together still make the
          // BFS solver punt — leave complexBfs on.
          complexBfs: true,
          apply() {
            // Layout is stored as a Save-layout-shape snapshot above,
            // so we just hand it to the shared applyCustomLevel writer
            // and let it materialize env / items / IN / OUT / buttons.
            applyCustomLevel(LAYOUT_ORDERED_ESCAPE);
          },
        },
        {
          // Level 13 (UI) is intentionally a blank canvas the player
          // can edit into their own custom level via the in-game
          // editor. The default IN/OUT cells from init() stay where
          // they are, no walls/env/spiders/rocks/etc. are placed.
          id: 'sandbox',
          name: 'Sandbox',
          features: [],
          corridor: false,
          complexBfs: false,
          apply({ state }) {
            state.spiders = [];
          },
        },
        {
          // Level 14 (UI) bonus: "You may now pet the spiders".
          // Post-victory petting zoo — spiders are friendly, march
          // toward IN, and despawn on arrival. Player + spider may
          // share cells. No-knife petting = +100; knife-in-hand
          // accident = −100. Only visible in the level-jump row
          // after STORAGE_KEY_PETTING_ZOO_UNLOCKED is set (which
          // happens automatically on Ordered Escape clear).
          id: 'you-may-now-pet-the-spiders',
          name: 'You may now pet the spiders',
          features: ['bonus'],
          corridor: false,
          // BFS solver punts — spider AI is on rails (march to IN)
          // and there's no real "minimum-turns" puzzle here.
          complexBfs: true,
          apply({ state, OUT_CELL, markCells, spawnSpidersFrom }) {
            OUT_CELL.c = LAYOUT_PET_THE_SPIDERS_OUT.c;
            OUT_CELL.r = LAYOUT_PET_THE_SPIDERS_OUT.r;
            markCells(state.weapons, LAYOUT_PET_THE_SPIDERS_WEAPONS);
            spawnSpidersFrom(LAYOUT_PET_THE_SPIDERS_SPIDERS);
          },
        },
      ];

      // Lookup helper. Returns the descriptor for a slot, or null for
      // out-of-range slots (custom-saved layouts beyond LEVEL_ORDER, or
      // the random-pipeline fallback).
      function getLayout(level) {
        return LEVEL_ORDER[level] || null;
      }

      // Derived: { 0: 'Hallway', 1: 'Spider Love', ... }. Kept for the
      // existing call sites that key directly into LEVEL_NAMES.
      const LEVEL_NAMES = Object.fromEntries(
        LEVEL_ORDER.map((layout, i) => [i, layout.name])
      );

      const SPIDER_SPEED = 1;
      // Baby spiders move at this speed and graduate into adults after
      // BABY_GROW_TURNS spider phases of life.
      const BABY_SPEED = 2;
      const BABY_GROW_TURNS = 3;
      // Hard cap on total spiders so love mode can’t blow up the population.
      const MAX_SPIDERS = 12;
      const WEAPON_COUNT = 3;
      const POTION_COUNT = 2;
      // How many of the holder's own turns an Invisibility Potion lasts.
      const INVISIBILITY_TURNS = 4;

      // Slide glyph: four arrows pointing in each cardinal direction, drawn
      // as inline SVG so it renders crisply at any cell size.
      const SLIDE_GLYPH_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:80%;height:80%;fill:currentColor;"><path d="M12 1 L7.5 6.5 H10.5 V10.5 H13.5 V6.5 H16.5 Z"/><path d="M23 12 L17.5 7.5 V10.5 H13.5 V13.5 H17.5 V16.5 Z"/><path d="M12 23 L16.5 17.5 H13.5 V13.5 H10.5 V17.5 H7.5 Z"/><path d="M1 12 L6.5 16.5 V13.5 H10.5 V10.5 H6.5 V7.5 Z"/></svg>';

      // Environment registry. onEnter(player, dir) runs when a player lands on the cell.
      // dir = { dc, dr } is the direction the player was moving when they entered.
      const ENV_TYPES = {
        neutral:   { name: 'neutral',   glyph: '',  onEnter: null },
        slide:     { name: 'slide',     glyph: SLIDE_GLYPH_SVG, onEnter: handleSlide },
        // River: a directional water current. Each river cell carries its
        // own flow direction in state.riverDirs[r][c]. A player who enters
        // (or starts their turn on) a river is moved one cell in that
        // direction; if the next cell is also a river the flow continues
        // with that cell's direction, chaining through corners. Stops on
        // any non-river non-blocking cell (and triggers that cell's
        // onEnter), or on walls/rocks/locks/edges.
        river:     { name: 'river',     glyph: '',  onEnter: handleRiver },
        knight:    { name: 'knight',    glyph: '♞', onEnter: handleKnight },
        // Green Knight: mirror of Knight. Same chess-knight jump shape
        // but offset 1 to the LEFT of the travel direction (regular
        // Knight is +1 right). Visual is identical to Knight except the
        // glyph is rendered horizontally flipped. All blockers match
        // the regular Knight (off-grid / boulder / rock / locked-
        // without-button-held-open all fail the jump).
        'green-knight': { name: 'green-knight', glyph: '♞', onEnter: handleGreenKnight },
        lava:      { name: 'lava',      glyph: '🌋', onEnter: handleLava },
        tnt:       { name: 'tnt',       glyph: '✸', onEnter: handleTnt },
        // Wall has no onEnter — entering is fine. The blocking happens at
        // departure time inside legalMoves(). The blocked direction is
        // stored per-cell in state.wallDirs. The center glyph is empty
        // because the .wall-bar overlays already communicate the wall sides.
        wall:      { name: 'wall',      glyph: '',  onEnter: null },
        // Purple Portal: walking onto a portal does NOTHING. The dashed bar
        // acts as a one-way teleport gate — a player who is ALREADY on a
        // portal cell and chooses to move in the bar's direction is
        // teleported to the partner portal cell instead of stepping that
        // way. After the teleport their facing direction is the OPPOSITE of
        // the partner's bar (i.e. they emerge from the partner pointing
        // outward, away from the bar). See movePlayer + legalMoves for the
        // gate logic.
        portal:    { name: 'portal',    glyph: '',  onEnter: null },
        // Yellow Portal: a second color of paired teleport gate. Mechanics
        // are identical to the purple portal — same exit-via-bar rule, same
        // slide auto-teleport behavior — but yellow portals only pair with
        // OTHER yellow portals (and purple only with purple). The partner
        // lookup matches on env type for this reason.
        'portal-y':{ name: 'portal-y',  glyph: '',  onEnter: null },
        // Blue Portal: third paired teleport color. Identical mechanics —
        // pairs only with another blue portal.
        'portal-b':{ name: 'portal-b',  glyph: '',  onEnter: null },
        // Red Portal: fourth paired teleport color. Identical mechanics —
        // pairs only with another red portal.
        'portal-r':{ name: 'portal-r',  glyph: '',  onEnter: null },
        // Green-portal variant. Same teleport mechanics, pairs only with
        // another green portal.
        'portal-g':{ name: 'portal-g',  glyph: '',  onEnter: null },
        // Boulder: behaves as a wall with all four directions blocked. Players
        // cannot enter via traverse moves OR jump moves — boulders are solid
        // rock. Spiders also refuse to enter boulders. (A wall cell with all
        // four directions blocked is similar but not identical: jumps CAN
        // land there, and the player will be soft-locked until reset.)
        boulder:   { name: 'boulder',   glyph: '',  onEnter: null },
        // Button: an interactive cell that activates when a Player or a
        // Rock is on it (other entities — spiders, knights, boulders — do
        // NOT trigger it). Each button is wired to one or more target
        // cells via state.buttons[].targets. Effects are derived from the
        // contents of each target cell at trigger time:
        //   • TnT target — edge-triggered, one-shot: on the first OFF→ON
        //     transition the TnT detonates (env reverts to neutral). Any
        //     rocks/players/spiders on the target cell die in the blast.
        //   • Lock target — level-triggered: while the button is ON the
        //     lock is treated as passable (without consuming a key). When
        //     the button releases (no player/rock remains on it) the
        //     lock blocks again. No state mutation on the lock itself —
        //     just a virtual override checked at movement-validation time.
        // onEnter is null because stepping onto the button is not what
        // makes it "fire" — the press is detected at the end of each
        // turn by processButtonPresses() reading whoever currently sits
        // on the cell. The render loop adds a .button-on CSS modifier
        // based on isButtonPressed() at paint time.
        button:    { name: 'button',    glyph: '',  onEnter: null },
        // Tree: a passable obscuring tile. Players and spiders may move
        // through tree cells freely. Items placed on a tree cell are
        // hidden visually under the canopy (the underlying state is
        // untouched — a key under a tree still exists and can be picked
        // up by stepping onto the cell). Players standing on a tree are
        // invisible to spiders: spiders do not chase them as targets and
        // a spider that lands on the same cell does not collide. Rocks
        // cannot be pushed into trees (the canopy is treated as green-knight', 'a soft
        // barrier for shoves). onEnter is null because stepping onto a
        // tree has no immediate side effect — the invisibility benefit
        // is checked at end-of-turn by the spider AI.
        tree:      { name: 'tree',      glyph: '',  onEnter: null },
      };
      // Cycle order for the in-board editor.
      const ENV_CYCLE = ['neutral', 'slide', 'river', 'knight', 'lava', 'tnt', 'wall', 'portal', 'portal-y', 'portal-b', 'portal-r', 'portal-g', 'boulder', 'button', 'tree'];

      // ── State ────────────────────────────────────────────────────────────
      const state = {
        env: [],            // env[r][c] = type key
        weapons: [],        // weapons[r][c] = boolean (chest contains a Spider Knife)
        potions: [],        // potions[r][c] = boolean (chest contains an Invisibility Potion)
        cakes: [],          // cakes[r][c]   = boolean (cake on the floor; +100 on pickup)
        keys: [],           // keys[r][c]    = boolean (golden key on the floor; +1 to player's key stack on pickup)
        locks: [],          // locks[r][c]   = boolean (cell is locked; entities cannot enter unless a player spends a key)
        wallDirs: [],       // wallDirs[r][c] = array of { dc, dr } — directions blocked when leaving a Wall cell (1–4 dirs), or null
        portalDirs: [],     // portalDirs[r][c] = single { dc, dr } — the bar direction of a Portal cell (outward facing), or null
        riverDirs: [],      // riverDirs[r][c] = single { dc, dr } — the flow direction of a River cell, or null
        spiders: [],        // [{ c, r, alive: true }]
        spidersInitial: [], // snapshot of state.spiders at the end of init(); restored on player death so spiders bounce back to start while turn count carries on
        rocksInitial: [],   // snapshot of state.rocks at the end of init(); restored on player death so any pushed rocks return to their start cells
        envInitial: [],     // snapshot of state.env at the end of init(); restored on player death so rock-into-lava boulders and rock-into-tnt detonations are undone
        weaponsInitial: [], // snapshot of state.weapons at the end of init(); restored on player death so picked-up knives/chests come back
        potionsInitial: [], // snapshot of state.potions at the end of init(); restored on player death so picked-up potions come back
        cakesInitial: [],   // snapshot of state.cakes at the end of init(); restored on player death so picked-up cakes come back
        respawnSpidersFlag: false, // set true in killPlayer; finalizeMove restores spiders/rocks/env/weapons/potions/cakes from their *Initial snapshots after the spider phase
        pendingFx: [],      // queue of one-shot animations to play on the next render
        pendingPath: null,  // when set, the active traverse path to animate this turn: [{c,r}, ...] starting at the player's pre-move cell
        animating: false,   // true while a traverse animation is playing; click handlers ignore input
        players: [],        // built dynamically from setup (1, 2, or 3 entries)
        numPlayers: 1,      // chosen on the setup screen
        playerNames: ['', '', ''],
        spiderFree: false,  // when true, render spiders as worms (cosmetic-only)
        currentPlayer: 0,
        winner: null,
        editMode: false,
        level: 0,           // 0..MAX_LEVEL-1; reaching OUT advances
        turnsThisLevel: 0,  // total moves the players have made on this level (resets on init)
        levelCleared: false,// true while the Level Cleared modal is up (game paused waiting for Next Level)
        levelClearedTurns: 0, // turn count snapshot displayed in the modal
        carryOver: null,    // when non-null on init(): array of { weapons, invisibleTurnsLeft, potions, keys } per player, restored after rebuild
        // Score tracking. Score persists across init() calls (level resets +
        // level transitions); only a full game reset (showSetup) zeroes it.
        score: 0,           // running total
        scoreLog: [],       // last 5 point-earning events: [{ label, points }, ...] newest-first
        // Undo: single-step rewind. Set to a state snapshot at the top
        // of movePlayer; cleared on Undo consume so a player can't undo
        // twice in a row. See takeUndoSnapshot / undoLastMove.
        undoSnapshot: null,
        // First-try bonus: flipped to true on player death or level
        // reset, gating the +300 "First-try Bonus" awarded in
        // finalizeMove on level clear. Reset to false on init().
        diedThisLevel: false,
        // "Discovered" map for the legend's chest contents. A given key
        // here stores the level number on which the player first opened a
        // chest of that type. Used to be checked when rendering the legend
        // (state.level > discovered[key]) but the legend is now always-on,
        // so this is kept only as a record of when each chest was first
        // opened — useful for any future progression UI.
        discovered: { knife: null, potion: null },
        // User-saved level layouts (from the Save-layout tool in edit
        // mode). Keyed by level number. When a key is present, init's
        // level-branch ladder skips the built-in branch and applies the
        // custom snapshot instead. Loaded from localStorage at script
        // startup; mutated via the save modal.
        customLevels: {},
        // Sandbox flag: when true, init() short-circuits before player
        // setup / render so callers can materialize a target level into
        // state.env / state.wallDirs / etc. for preview, then restore the
        // real state. Always cleared back to false after a sandbox pass.
        _sandboxLevel: false,
        // Edit-mode dirty flag. Set to true on every editor mutation
        // (paint, erase, move, copy, wire, IN/OUT relocate). Cleared
        // when entering edit mode, and when the user commits a layout
        // via the Save Layout modal. Drives the "you have unsaved
        // changes — discard?" confirm gate that protects against
        // accidental level-jump / Reset / Edit-Mode-toggle / page-unload.
        editorDirty: false,
        // Playtest scratch snapshot. When non-null, init() applies it
        // before LEVEL_ORDER / customLevels lookup, so Reset Level
        // replays the same draft. Shape: { level: number, snap: <save> }.
        // Set by enterPlaytestMode(); cleared by exitPlaytestMode().
        _playtestSnapshot: null,
      };

      // ── Spider-free mode: text swap helpers ──────────────────────────────
      // When state.spiderFree is true, all displayed game copy that says
      // "Spider"/"spider"/"Spiders"/"spiders" (or "Spider Knife") should be
      // rendered as the worm equivalent. We do this in two ways:
      //
      //  1. wormify(s)  — used inline by JS that builds dynamic strings
      //                   (level title, loadout text, pickup FX).
      //  2. applySpiderFreeText() — mutates a small list of static HTML
      //                   elements in the legend / rules / on-the-board card.
      //                   We snapshot their original innerHTML on first run
      //                   so resets / toggles can swap cleanly both ways.
      function wormify(s) {
        if (!state.spiderFree || s == null) return s;
        // Order matters: longer / more-specific phrases first. The
        // (?<!--) negative lookbehinds protect CSS custom-property
        // references like var(--spider) from getting mangled when we
        // wormify cached innerHTML.
        return String(s)
          .replace(/Spider Knife/g, 'Worm Knife')
          .replace(/Spider knife/g, 'Worm knife')
          .replace(/spider knife/g, 'worm knife')
          .replace(/(?<!--)Spiders/g, 'Worms')
          .replace(/(?<!--)spiders/g, 'worms')
          .replace(/(?<!--)Spider/g, 'Worm')
          .replace(/(?<!--)spider/g, 'worm');
      }

      // IDs / selectors of static HTML elements whose visible copy mentions
      // spiders. We don't include the Spider-free toggle's own label (it
      // describes the feature itself), the page <title>, or the prototype
      // <h1> (those are the brand name).
      // Cache for original innerHTML so toggling spider-free can flip both
      // directions cleanly.
      const spiderFreeOriginals = new WeakMap();

      function applySpiderFreeText() {
        // Collect the actual element refs lazily on first run.
        const els = [];
        // 1. Legend feature li's that mention spiders: spider, knife (Spider
        //    Knife), and the (now generic) chest entry. Potion entry has no
        //    spider mention but we add it harmlessly to keep the list stable.
        const legend = document.getElementById('board-legend');
        if (legend) {
          const spiderLi = legend.querySelector('li[data-feature="spider"]');
          if (spiderLi) els.push(spiderLi);
          const chestLi  = legend.querySelector('li[data-feature="chest"]');
          if (chestLi)  els.push(chestLi);
          const knifeLi  = legend.querySelector('li[data-feature="knife"]');
          if (knifeLi)  els.push(knifeLi);
          const potionLi = legend.querySelector('li[data-feature="potion"]');
          if (potionLi) els.push(potionLi);
        }
        // 2. "Spiders alive" badge row in the On the board card. Find it
        //    by the spider-count badge sibling.
        const spiderCountBadge = document.getElementById('spider-count');
        if (spiderCountBadge) {
          const row = spiderCountBadge.closest('.player-row');
          if (row) {
            const labelSpan = row.querySelector('span');
            if (labelSpan) els.push(labelSpan);
          }
        }
        // 3. Rules — current panel: every <li> that mentions a spider.
        const rulesUls = document.querySelectorAll('aside .rules');
        rulesUls.forEach((ul) => {
          ul.querySelectorAll('li').forEach((li) => {
            // Cache lazily; only swap if the original text actually
            // mentioned a spider (otherwise a no-op).
            if (/spider/i.test(li.innerHTML)) els.push(li);
          });
        });

        for (const el of els) {
          if (!spiderFreeOriginals.has(el)) {
            spiderFreeOriginals.set(el, el.innerHTML);
          }
          const original = spiderFreeOriginals.get(el);
          el.innerHTML = state.spiderFree ? wormify(original) : original;
        }
      }

      // ── Level Cleared modal ──────────────────────────────────────────────
      // Pauses the game with a celebratory readout of the turn count and a
      // Next Level button. Wired up at the bottom of this script.
      // ── Score helpers ────────────────────────────────────────────────────
      // Mutate state.score and (optionally) push a label into the rolling
      // scoreLog of the last 5 point-earning events. Pass label=null to
      // silently adjust the score without surfacing a log entry.
      //
      // Labelled events are also pushed to state.levelScoreEvents — a
      // per-level audit list (reset on init()) used to render the grouped
      // breakdown on the Level Cleared modal.
      function addScore(points, label) {
        if (typeof points !== 'number' || !Number.isFinite(points)) return;
        state.score += points;
        if (label) {
          state.scoreLog.unshift({ label, points });
          // Cap to last 5 entries.
          if (state.scoreLog.length > 5) state.scoreLog.length = 5;
          if (!state.levelScoreEvents) state.levelScoreEvents = [];
          state.levelScoreEvents.push({ label, points });
        }
      }

      // ── Undo (single-step rewind) ────────────────────────────────────
      // Snapshot the bits of state that movePlayer / finalizeMove mutate
      // during a single move (cell layers, rocks, spiders, players,
      // score/log, turn counter, current-player). Stored as a shallow
      // copy with per-row clones for the 2D layers and per-element
      // clones for spiders + players. Cleared after a successful undo
      // so the player can't undo twice in a row — a fresh snapshot is
      // taken at the top of movePlayer for the NEXT move.
      function takeUndoSnapshot() {
        state.undoSnapshot = {
          env: state.env.map((row) => row.slice()),
          weapons: state.weapons.map((row) => row.slice()),
          potions: state.potions.map((row) => row.slice()),
          cakes: state.cakes.map((row) => row.slice()),
          keys: state.keys.map((row) => row.slice()),
          locks: state.locks.map((row) => row.slice()),
          rocks: state.rocks.map((row) => row.slice()),
          spiders: state.spiders.map((s) => ({
            c: s.c, r: s.r, alive: s.alive,
            isBaby: !!s.isBaby,
            babyTurnsLeft: s.babyTurnsLeft || 0,
            justBorn: !!s.justBorn,
          })),
          players: state.players.map((p) => ({
            ...p,
            lastDir: p.lastDir ? { ...p.lastDir } : { dc: 0, dr: 0 },
          })),
          score: state.score,
          scoreLog: state.scoreLog.slice(),
          levelScoreEvents: (state.levelScoreEvents || []).slice(),
          turnsThisLevel: state.turnsThisLevel,
          currentPlayer: state.currentPlayer,
          diedThisLevel: !!state.diedThisLevel,
        };
      }
      function canUndo() {
        if (!state.undoSnapshot) return false;
        if (state.editMode) return false;
        if (state.animating) return false;
        if (state.winner !== null) return false;
        if (state.levelCleared) return false;
        return true;
      }
      function undoLastMove() {
        if (!canUndo()) return;
        const snap = state.undoSnapshot;
        state.env = snap.env.map((row) => row.slice());
        state.weapons = snap.weapons.map((row) => row.slice());
        state.potions = snap.potions.map((row) => row.slice());
        state.cakes = snap.cakes.map((row) => row.slice());
        state.keys = snap.keys.map((row) => row.slice());
        state.locks = snap.locks.map((row) => row.slice());
        state.rocks = snap.rocks.map((row) => row.slice());
        state.spiders = snap.spiders.map((s) => ({ ...s }));
        state.players = snap.players.map((p) => ({
          ...p,
          lastDir: p.lastDir ? { ...p.lastDir } : { dc: 0, dr: 0 },
        }));
        state.score = snap.score;
        state.scoreLog = snap.scoreLog.slice();
        state.levelScoreEvents = snap.levelScoreEvents.slice();
        state.turnsThisLevel = snap.turnsThisLevel;
        state.currentPlayer = snap.currentPlayer;
        state.diedThisLevel = snap.diedThisLevel;
        state.respawnSpidersFlag = false;
        state.pendingPath = null;
        state.pendingFx = [];
        state.undoSnapshot = null; // consumed — re-arm on the next move
        // Re-sync button _on edges with the restored rocks + players so
        // the next press fires a clean OFF→ON transition.
        if (typeof rebaselineButtons === 'function') rebaselineButtons();
        render();
        updateUndoButton();
      }
      function updateUndoButton() {
        const btn = document.getElementById('undo-btn');
        if (!btn) return;
        const enabled = canUndo();
        btn.disabled = !enabled;
        btn.classList.toggle('undo-armed', enabled);
      }

      // Aggregate state.levelScoreEvents into a list of
      // { label, count, total } rows, preserving first-occurrence order so
      // the breakdown reads chronologically (e.g. picked up knife, killed
      // spider, eaten by spider, cleared level).
      function aggregateLevelScoreEvents() {
        const events = state.levelScoreEvents || [];
        const order = [];
        const byLabel = new Map();
        for (const ev of events) {
          if (!byLabel.has(ev.label)) {
            byLabel.set(ev.label, { label: ev.label, count: 0, total: 0 });
            order.push(ev.label);
          }
          const row = byLabel.get(ev.label);
          row.count += 1;
          row.total += ev.points;
        }
        return order.map((k) => byLabel.get(k));
      }

      function showLevelClearedModal() {
        const overlay = document.getElementById('level-cleared-overlay');
        const titleEl = document.getElementById('level-cleared-title');
        const taglineEl = document.getElementById('level-cleared-tagline');
        const winMsgEl = document.getElementById('level-cleared-win-message');
        const totalLabelEl = document.getElementById('level-cleared-breakdown-total-label');
        const nextBtn = document.getElementById('next-level-btn');
        const turnsEl = document.getElementById('level-cleared-turns');
        const wordEl  = document.getElementById('level-cleared-turn-word');
        if (turnsEl) turnsEl.textContent = String(state.levelClearedTurns || 0);
        if (wordEl)  wordEl.textContent  = (state.levelClearedTurns === 1) ? 'turn' : 'turns';

        // Final-level treatment: when the player cleared the last
        // hand-authored level (Ordered Escape, UI "12" → LEVEL_ORDER[11]),
        // swap the modal into a "YOU WON!" celebration and surface the
        // sandbox / level 13 invitation. The next-level button still
        // advances to the next slot, so the player drops straight into
        // the editable Sandbox.
        const isFinalAuthored = (state.lastClearedLevel === 11);
        if (titleEl)      titleEl.textContent = isFinalAuthored ? 'YOU WON!' : 'Level Cleared!';
        if (taglineEl)    taglineEl.innerHTML = isFinalAuthored
          ? 'You escaped every level &mdash; congratulations.'
          : 'You\'re safe&hellip;for now';
        if (winMsgEl)     winMsgEl.classList.toggle('hidden', !isFinalAuthored);
        if (totalLabelEl) totalLabelEl.textContent = isFinalAuthored ? 'Final Score' : 'Final Score';
        if (nextBtn)      nextBtn.innerHTML = isFinalAuthored
          ? 'Build a level (Lv 13) &rarr;'
          : 'Next Level &rarr;';
        // Bonus-path CTA: only visible on the YOU-WON state. Clicking
        // jumps directly into the petting-zoo bonus level so the
        // player doesn't have to detour through Sandbox first.
        const pettingBtn = document.getElementById('petting-zoo-btn');
        if (pettingBtn) pettingBtn.classList.toggle('hidden', !isFinalAuthored);
        // First time the player clears Ordered Escape: persist the
        // editor unlock so the EDIT MODE sidebar card becomes visible
        // (and stays visible across reloads). No-op on later clears.
        if (isFinalAuthored) unlockEditor();
        // Same trigger unlocks the post-victory bonus level
        // ("You may now pet the spiders" — PETTING_ZOO_LEVEL_INDEX).
        // The unlock helper rebuilds the level-jump row so the new
        // chip appears immediately on the next render.
        if (isFinalAuthored) unlockPettingZoo();

        // Render grouped breakdown. The "Cleared Level N" event is already
        // in state.levelScoreEvents at this point because addScore() was
        // called in finalizeMove just before showLevelClearedModal().
        const breakdownEl = document.getElementById('level-cleared-breakdown');
        const listEl      = document.getElementById('level-cleared-breakdown-list');
        const totalEl     = document.getElementById('level-cleared-breakdown-total');
        if (breakdownEl && listEl && totalEl) {
          const rows = aggregateLevelScoreEvents();
          listEl.innerHTML = '';
          let net = 0;
          for (const row of rows) {
            net += row.total;
            const li = document.createElement('li');
            const lbl = document.createElement('span');
            lbl.className = 'lbl';
            lbl.textContent = row.count > 1 ? `${row.label} ×${row.count}` : row.label;
            const pts = document.createElement('span');
            pts.className = 'pts ' + (row.total >= 0 ? 'pos' : 'neg');
            pts.textContent = (row.total >= 0 ? '+' : '') + row.total;
            li.appendChild(lbl);
            li.appendChild(pts);
            listEl.appendChild(li);
          }
          totalEl.textContent = (net >= 0 ? '+' : '') + net;
          breakdownEl.classList.toggle('hidden', rows.length === 0);
        }

        if (overlay) overlay.classList.remove('hidden');
      }

      function init() {
        // Reset IN_CELL and OUT_CELL to their defaults before any
        // per-level branch can reassign them. Levels that relocate IN
        // (e.g. Level 11 "Ford the River") or OUT (e.g. Level 5)
        // overwrite IN_CELL / OUT_CELL .c / .r below; everything else
        // inherits the default. Without this reset, an IN/OUT
        // override from the previously-played level would leak into
        // every subsequent level.
        IN_CELL.c  = DEFAULT_IN_CELL.c;
        IN_CELL.r  = DEFAULT_IN_CELL.r;
        OUT_CELL.c = DEFAULT_OUT_CELL.c;
        OUT_CELL.r = DEFAULT_OUT_CELL.r;
        state.env = Array.from({ length: ROWS }, () =>
          Array.from({ length: COLS }, () => 'neutral')
        );
        state.weapons = Array.from({ length: ROWS }, () =>
          Array.from({ length: COLS }, () => false)
        );
        state.potions = Array.from({ length: ROWS }, () =>
          Array.from({ length: COLS }, () => false)
        );
        state.cakes = Array.from({ length: ROWS }, () =>
          Array.from({ length: COLS }, () => false)
        );
        state.keys = Array.from({ length: ROWS }, () =>
          Array.from({ length: COLS }, () => false)
        );
        state.locks = Array.from({ length: ROWS }, () =>
          Array.from({ length: COLS }, () => false)
        );
        state.wallDirs = Array.from({ length: ROWS }, () =>
          Array.from({ length: COLS }, () => null)
        );
        state.portalDirs = Array.from({ length: ROWS }, () =>
          Array.from({ length: COLS }, () => null)
        );
        state.riverDirs = Array.from({ length: ROWS }, () =>
          Array.from({ length: COLS }, () => null)
        );
        // Rocks are a separate boolean layer that lives on top of state.env
        // so a rock can sit on (and be pushed off of) any underlying env
        // type without overwriting it — push interactions are non-destructive.
        state.rocks = Array.from({ length: ROWS }, () =>
          Array.from({ length: COLS }, () => false)
        );
        // Buttons live in a sparse list (not a per-cell layer) because each
        // button carries a wiring payload — its list of target cells — that
        // a per-cell boolean grid can't represent. The button cell itself is
        // still recorded as state.env[r][c] === 'button' for rendering / env
        // tooling consistency; this list is the source of truth for the
        // wiring + runtime ON/OFF state (b._on, updated by
        // processButtonPresses each turn).
        state.buttons = [];
        state.pendingFx = [];
        state.pendingPath = null;
        state.animating = false;
        state.spiders = [];

        // ---- Hand-placed-layout helpers ----
        // Tiny utilities used by the per-level branches below to apply
        // their hand-placed layout lists. They all close over `state`
        // and exist only to keep each branch focused on layout intent.
        // - applyEnvList: paint a single env type onto every {c,r} cell.
        // - applyWallList: paint walls AND clone their per-cell dirs.
        // - applyPortalList: paint portal/portal-y/portal-b/portal-r/portal-g AND record dir.
        // - markCells: flip a boolean grid (e.g. weapons, potions) on.
        // - spawnSpidersFrom: replace state.spiders with fresh entries
        //   from a {c,r} list. Each spider is alive, not a baby, no script.
        //   (Distinct from the outer spawnSpiders(count) which scatters
        //   spiders randomly into empty bottom-half cells.)
        function applyEnvList(envType, list) {
          for (const { c, r } of list) {
            state.env[r][c] = envType;
          }
        }
        function applyWallList(list) {
          for (const { c, r, dirs } of list) {
            state.env[r][c] = 'wall';
            state.wallDirs[r][c] = dirs.map((d) => ({ dc: d.dc, dr: d.dr }));
          }
        }
        function applyPortalList(envType, list) {
          for (const { c, r, dir } of list) {
            state.env[r][c] = envType;
            state.portalDirs[r][c] = { dc: dir.dc, dr: dir.dr };
          }
        }
        function applyRiverList(list) {
          for (const { c, r, dir } of list) {
            state.env[r][c] = 'river';
            state.riverDirs[r][c] = { dc: dir.dc, dr: dir.dr };
          }
        }
        function markCells(grid, list) {
          for (const { c, r } of list) {
            grid[r][c] = true;
          }
        }
        function spawnSpidersFrom(list) {
          state.spiders = list.map(({ c, r }) => ({
            c, r,
            alive: true,
            isBaby: false,
            babyTurnsLeft: 0,
            justBorn: false,
          }));
        }

        // Dispatch order:
        //   1. Custom layout (Save-layout snapshot) — overrides everything.
        //   2. Built-in layout from LEVEL_ORDER — each entry's apply()
        //      callback materializes the layout from its LAYOUT_* data
        //      constants. Slot-specific behavior (corridor mode, BFS
        //      bailout, feature reveal) all flows from the descriptor.
        //   3. Fallback random pipeline — for slots beyond LEVEL_ORDER
        //      (e.g. orphaned custom slots or runtime-appended levels).
        // Playtest scratch takes top priority: when set, every init()
        // (including Reset Level) re-applies the in-flight editor draft
        // without disturbing the actual customLevels save. Cleared by
        // exitPlaytestMode().
        if (state._playtestSnapshot && state._playtestSnapshot.level === state.level) {
          applyCustomLevel(state._playtestSnapshot.snap);
        } else if (state.customLevels && state.customLevels[state.level]) {
          // User-saved layout (from the Save-layout tool). Fully overrides
          // the built-in level branch — applyCustomLevel writes env / items
          // / IN / OUT / spiders / etc. directly from the stored snapshot.
          applyCustomLevel(state.customLevels[state.level]);
        } else if (getLayout(state.level)) {
          // Built-in layout. Each entry in LEVEL_ORDER is self-contained
          // (name + features + corridor flag + apply()), so reordering
          // LEVEL_ORDER swaps slot positions without touching this
          // dispatch or any other call site.
          getLayout(state.level).apply({
            state,
            IN_CELL,
            OUT_CELL,
            applyEnvList,
            applyWallList,
            applyPortalList,
            applyRiverList,
            markCells,
            spawnSpidersFrom,
          });
        } else {
          // Fallback random pipeline for slots beyond LEVEL_ORDER (e.g.
          // a custom-saved slot whose snapshot has been deleted, or
          // future levels appended at runtime past MAX_LEVEL).
          placeEffectsRandom();
          spawnSpiders(SPIDER_COUNT);
          placeWeapons();
          placePotions();
          // (No cake placement for random levels — there is no
          // placeCakes() helper. Cakes are only placed for hand-authored
          // layouts via markCells(state.cakes, …).)
          // Random levels beyond the curated list also get rocks as a
          // movable obstacle on neutral cells (no effects, no items, no
          // spiders).
          placeRocks(4);
        }

        // Sandbox short-circuit: callers (e.g. the Save-layout preview)
        // set state._sandboxLevel before calling init() so they can
        // materialize a level's layout into state.env / state.wallDirs /
        // etc. without disturbing players, score, render, or DOM. The
        // caller is responsible for restoring state afterwards.
        if (state._sandboxLevel) return;

        // Build players dynamically from setup choices (1, 2, or 3 of them).
        const n = Math.max(1, Math.min(3, state.numPlayers || 1));
        state.players = Array.from({ length: n }, (_, i) => ({
          id: i + 1,
          name: (state.playerNames[i] && state.playerNames[i].trim()) || `Player ${i + 1}`,
          c: null,
          r: null,
          status: 'off-grid',
          lastDir: { dc: 0, dr: 0 },
          skipNext: false,
          weapons: 0,             // count of Spider Knives held; weapons stack and are consumed one per kill
          invisibleTurnsLeft: 0,
          potions: 0,             // count of unspent Invisibility Potions; player drinks one manually via Drink Potion / P key
          keys: 0,                // count of Keys held; keys stack and are consumed one per unlock
        }));
        // If we're advancing from a cleared level, restore weapons + invisibility
        // each player was carrying. carryOver is set in finalizeMove right before
        // the Level Cleared modal is shown, and consumed (then cleared) here.
        if (state.carryOver && Array.isArray(state.carryOver)) {
          for (let i = 0; i < state.players.length; i++) {
            const co = state.carryOver[i];
            if (!co) continue;
            state.players[i].weapons = co.weapons || 0;
            state.players[i].invisibleTurnsLeft = co.invisibleTurnsLeft || 0;
            state.players[i].potions = co.potions || 0;
            state.players[i].keys = co.keys || 0;
          }
          state.carryOver = null;
        }
        state.currentPlayer = 0;
        state.winner = null;
        state.editMode = false;
        state.turnsThisLevel = 0;
        state.levelCleared = false;
        state.levelClearedTurns = 0;
        // Invalidate the min-turn BFS cache so the new level recomputes.
        state._minTurnsCache = null;
        // Hide the Level Cleared modal in case init was triggered by the
        // Next Level button or a level reset while the modal was up.
        const lcOverlay = document.getElementById('level-cleared-overlay');
        if (lcOverlay) lcOverlay.classList.add('hidden');
        document.body.classList.remove('edit-mode');
        // Tutorial-corridor mode shrinks the board to a 10×3 strip via
        // CSS (body.corridor-mode hides rows 2..10). Driven off the
        // layout descriptor's corridor flag so any layout can opt in
        // by setting corridor: true — currently only LAYOUT_HALLWAY does.
        document.body.classList.toggle('corridor-mode', getLayout(state.level)?.corridor === true);
        // Layout-id body class — lets CSS apply per-layout overrides
        // (e.g. pink spiders on the petting-zoo bonus level) without
        // touching the renderer. Toggle each layout id individually.
        document.body.classList.toggle(
          'layout-you-may-now-pet-the-spiders',
          getLayout(state.level)?.id === 'you-may-now-pet-the-spiders'
        );
        const editBtn = document.getElementById('edit-btn');
        if (editBtn) setEditButtonLabel(false);
        // If we're mid-playtest, restore the "Back to editor" label and
        // banner that setEditButtonLabel just clobbered. Cheap no-op
        // when not playtesting.
        if (typeof syncPlaytestBanner === 'function') {
          syncPlaytestBanner();
        }
        // Hide the EDIT MODE sidebar card until the player has finished
        // the campaign (i.e. cleared Ordered Escape). Idempotent.
        applyEditorUnlockedUI();
        // Show / hide player rows based on n.
        for (let i = 1; i <= 3; i++) {
          const row = document.querySelector(`[data-player-row="${i}"]`);
          const load = document.getElementById(`p${i}-loadout`);
          const nameEl = document.getElementById(`p${i}-name`);
          if (row)  row.style.display  = i <= n ? '' : 'none';
          if (load) load.style.display = i <= n ? '' : 'none';
          if (nameEl && state.players[i - 1]) nameEl.textContent = state.players[i - 1].name;
        }
        buildBoard();
        // Apply (or restore) spider/worm wording across the legend, rules,
        // and on-the-board card. Called every init() so it tracks toggles
        // made on the setup screen.
        applySpiderFreeText();
        // Snapshot spider start positions for this level so we can restore
        // them on player death (eaten -> spiders reset, turn count keeps
        // counting). Babies that emerge during love mode are NOT included
        // in the snapshot, so a respawn cleanly drops them.
        state.spidersInitial = state.spiders.map((s) => ({
          c: s.c, r: s.r,
          alive: true,
          isBaby: false,
          babyTurnsLeft: 0,
          justBorn: false,
        }));
        // Same idea for rocks: snapshot the rock layer at level start so a
        // player death rolls back any pushes from the failed attempt.
        state.rocksInitial = state.rocks.map((row) => row.slice());
        // Snapshot the env, weapons, potions, and cakes layers too. On
        // player death we restore all of these so a failed run is fully
        // undone: tnt cells respawn (even if a rock had detonated them),
        // lava cells return (even if a rock had filled them into a
        // boulder), picked-up knives/potions/cakes come back. Keys and
        // locks intentionally do NOT reset — keys the player picked up
        // before dying are kept (killPlayer doesn't zero p.keys), and
        // locks they unlocked stay unlocked, so progression toward a
        // gated goal isn't wiped out by a single bad turn.
        state.envInitial = state.env.map((row) => row.slice());
        state.weaponsInitial = state.weapons.map((row) => row.slice());
        state.potionsInitial = state.potions.map((row) => row.slice());
        state.cakesInitial = state.cakes.map((row) => row.slice());
        state.respawnSpidersFlag = false;
        // Snapshot the score at level start so "Reset Level" can roll back
        // any points (or penalties) earned during the current attempt.
        state.scoreAtLevelStart = state.score || 0;
        // Per-level audit log used to render the Level Cleared breakdown.
        // Reset here so each attempt at a level starts with a clean slate;
        // the running 5-entry side-panel scoreLog is kept (it's a global
        // recent-events tape, not a per-level summary).
        state.levelScoreEvents = [];
        // Undo is per-move, not per-level: clear any stale snapshot so
        // the player can't undo across a level transition or reset.
        state.undoSnapshot = null;
        // First-try bonus tracker: a fresh attempt starts undirtied.
        // killPlayer + resetCurrentLevel flip this to true; finalizeMove
        // checks it before awarding the +300 bonus on level clear.
        state.diedThisLevel = false;
        // Sync every button's _on flag with the board so a rock or player
        // sitting on a button at level-start doesn't get treated as a
        // fresh OFF→ON edge (which would re-fire TnT every reset). This
        // must run AFTER applyCustomLevel + all built-in layout branches
        // so state.buttons + state.rocks + state.players are settled.
        rebaselineButtons();
        render();
      }

      // ── Board DOM ────────────────────────────────────────────────────────
      const boardEl = document.getElementById('board');
      let cellEls = [];

      function buildBoard() {
        boardEl.innerHTML = '';
        cellEls = [];
        for (let r = 0; r < ROWS; r++) {
          const row = [];
          for (let c = 0; c < COLS; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.c = c;
            cell.dataset.r = r;
            // Explicit grid placement so hidden cells (e.g. Level 0
            // corridor mode) don't reflow the visible ones via auto-flow.
            cell.style.gridColumn = String(c + 1);
            cell.style.gridRow = String(r + 1);
            cell.setAttribute('role', 'gridcell');

            const coord = document.createElement('span');
            coord.className = 'coord';
            coord.textContent = `${c + 1},${r + 1}`;
            cell.appendChild(coord);

            if (isInCell(c, r)) {
              cell.classList.add('in');
              const lab = document.createElement('span');
              lab.className = 'label';
              lab.textContent = 'in';
              cell.appendChild(lab);
            }
            if (isOutCell(c, r)) {
              cell.classList.add('out');
              const lab = document.createElement('span');
              lab.className = 'label';
              lab.textContent = 'out';
              cell.appendChild(lab);
            }

            cell.addEventListener('click', () => onCellClick(c, r));
            boardEl.appendChild(cell);
            row.push(cell);
          }
          cellEls.push(row);
        }
      }

      // ── Helpers ──────────────────────────────────────────────────────────
      // Corridor levels (currently just "Hallway") only use the top three
      // rows; CSS hides rows 3..9 but the grid state still allocates
      // them. Restrict gameplay bounds so neither players nor spiders can
      // step into the hidden rows below the visible corridor. Driven off
      // the layout descriptor (LEVEL_ORDER[i].corridor) so reordering the
      // tutorial slot just works.
      function playableRows() { return getLayout(state.level)?.corridor ? 3 : ROWS; }
      function inBounds(c, r) { return c >= 0 && c < COLS && r >= 0 && r < playableRows(); }
      function isInCell(c, r)  { return c === IN_CELL.c  && r === IN_CELL.r;  }
      function isOutCell(c, r) { return c === OUT_CELL.c && r === OUT_CELL.r; }
      function isInOrOut(c, r) { return isInCell(c, r) || isOutCell(c, r); }
      function playerIdxOf(p)  { return state.players.indexOf(p); }
      function dirName(d) {
        if (!d) return '';
        if (d.dc === 0 && d.dr === -1) return 'n';
        if (d.dc === 0 && d.dr ===  1) return 's';
        if (d.dc === 1 && d.dr ===  0) return 'e';
        if (d.dc === -1 && d.dr === 0) return 'w';
        return '';
      }
      function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      }
      function chebyshev(a, b) {
        return Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));
      }
      function manhattan(a, b) {
        return Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
      }

      function isOccupiedByOther(c, r, playerIdx) {
        const other = state.players[1 - playerIdx];
        return other.status === 'on-grid' && other.c === c && other.r === r;
      }

      // ── Random placement ────────────────────────────────────────────────
      // Distribute effects evenly across the grid (Chebyshev spacing constraint),
      // skipping IN/OUT and a 1-cell halo around IN so the entry path is clean.
      function placeEffectsRandom(counts = EFFECT_COUNTS) {
        const eligible = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (isInOrOut(c, r)) continue;
            if (chebyshev({ c, r }, IN_CELL)  < 2) continue;
            if (chebyshev({ c, r }, OUT_CELL) < 1) continue;
            eligible.push({ c, r });
          }
        }
        shuffle(eligible);

        const totalNeeded = Object.values(counts).reduce((a, b) => a + b, 0);
        const placements = [];
        // First pass: enforce min spacing of 2 (no two effects within Chebyshev 1).
        for (const cell of eligible) {
          if (placements.length >= totalNeeded) break;
          const tooClose = placements.some((p) => chebyshev(p, cell) < 2);
          if (!tooClose) placements.push(cell);
        }
        // Fallback: relax spacing to 1 if we couldn't fit enough.
        if (placements.length < totalNeeded) {
          for (const cell of eligible) {
            if (placements.length >= totalNeeded) break;
            if (placements.some((p) => p.c === cell.c && p.r === cell.r)) continue;
            placements.push(cell);
          }
        }

        // Build a randomized type pool (interleaved so type order is shuffled).
        const typePool = [];
        for (const [t, n] of Object.entries(counts)) {
          for (let i = 0; i < n; i++) typePool.push(t);
        }
        shuffle(typePool);

        for (let i = 0; i < placements.length && i < typePool.length; i++) {
          const { c, r } = placements[i];
          state.env[r][c] = typePool[i];
          // Walls get a randomized set of 1–4 blocked directions at placement time.
          if (typePool[i] === 'wall') {
            state.wallDirs[r][c] = randomWallDirs();
          }
        }
      }

      // Place a small pack of rocks on neutral cells. Rocks live in the
      // separate state.rocks layer; they don't overwrite any underlying env.
      // Eligible cells: in bounds (excluding IN/OUT and a 1-cell halo around
      // IN), env === 'neutral', no weapons, no potions, no spider on the
      // cell, no other rock. Rocks are spaced apart by Chebyshev >= 2 when
      // possible, falling back to whatever fits.
      function placeRocks(count) {
        const eligible = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (isInOrOut(c, r)) continue;
            if (chebyshev({ c, r }, IN_CELL) < 2) continue;
            if (state.env[r][c] !== 'neutral') continue;
            if (state.weapons[r][c]) continue;
            if (state.potions[r][c]) continue;
            if (state.rocks[r][c]) continue;
            if (state.spiders.some((s) => s.alive && s.c === c && s.r === r)) continue;
            eligible.push({ c, r });
          }
        }
        shuffle(eligible);
        const placed = [];
        for (const cell of eligible) {
          if (placed.length >= count) break;
          if (placed.some((p) => chebyshev(p, cell) < 2)) continue;
          placed.push(cell);
        }
        if (placed.length < count) {
          for (const cell of eligible) {
            if (placed.length >= count) break;
            if (placed.some((p) => p.c === cell.c && p.r === cell.r)) continue;
            placed.push(cell);
          }
        }
        for (const { c, r } of placed) state.rocks[r][c] = true;
      }

      // Pick a random cardinal direction. Used for portals painted via the
      // in-board editor (the level setups above hard-code their bar directions).
      function randomCardinal() {
        const dirs = [
          { dc: 0, dr: -1 }, { dc: 0, dr: 1 },
          { dc: -1, dr: 0 }, { dc: 1, dr: 0 },
        ];
        return dirs[Math.floor(Math.random() * 4)];
      }

      // Locate the partner of the portal at (c, r). Portals are spawned in
      // pairs of MATCHING COLOR — purple pairs only with purple, yellow with
      // yellow, blue with blue, red with red, green with green. The lookup
      // matches on env type, so all five pairs can coexist on the same
      // board without cross-color teleports. Returns null if there's no
      // same-color partner (e.g. an in-editor mid-paint state).
      function isPortalKey(key) {
        return key === 'portal' || key === 'portal-y'
            || key === 'portal-b' || key === 'portal-r'
            || key === 'portal-g';
      }
      // Virtual portal-color override. If a Red Portal cell is currently
      // being held as a Button target by any pressed button, treat it as
      // a Yellow Portal for partner-matching + rendering. The underlying
      // state.env[r][c] is NEVER mutated by buttons (mirrors the
      // Lock-held-open pattern), so the portal returns to red the moment
      // the button releases. Returns the raw env key for any non-portal
      // cell or any portal that isn't being transformed.
      function effectivePortalKey(c, r) {
        const here = state.env[r] && state.env[r][c];
        if (!isPortalKey(here)) return here;
        if (here !== 'portal-r') return here;
        // Look for any pressed button wired to (c, r).
        if (!state.buttons || !state.buttons.length) return here;
        for (const b of state.buttons) {
          if (!isButtonPressed(b.c, b.r)) continue;
          for (const t of b.targets) {
            if (t.c === c && t.r === r) return 'portal-y';
          }
        }
        return here;
      }
      function getPartnerPortal(c, r) {
        const hereEff = effectivePortalKey(c, r);
        if (!isPortalKey(hereEff)) return null;
        for (let rr = 0; rr < ROWS; rr++) {
          for (let cc = 0; cc < COLS; cc++) {
            if (cc === c && rr === r) continue;
            if (effectivePortalKey(cc, rr) !== hereEff) continue;
            return { c: cc, r: rr };
          }
        }
        return null;
      }

      // Pick 1–4 distinct cardinal directions uniformly at random for a
      // wall's blocked sides.
      function randomWallDirs() {
        const dirs = [
          { dc: 0, dr: -1 }, // up
          { dc: 0, dr:  1 }, // down
          { dc:-1, dr:  0 }, // left
          { dc: 1, dr:  0 }, // right
        ];
        // Fisher–Yates shuffle, then take a random count from 1..4.
        for (let i = dirs.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
        }
        const count = 1 + Math.floor(Math.random() * 4);
        return dirs.slice(0, count);
      }

      // Spawn spiders on neutral cells in the BOTTOM HALF of the board so players
      // entering at the top corner have a beat to react. Avoid effect cells and weapons.
      function spawnSpiders(count = SPIDER_COUNT) {
        const halfRow = Math.floor(ROWS / 2); // bottom half = r >= halfRow
        const eligible = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (isInOrOut(c, r)) continue;
            if (r < halfRow) continue; // bottom half only
            if (chebyshev({ c, r }, IN_CELL) < 3) continue;
            if (state.env[r][c] !== 'neutral') continue;
            if (state.weapons[r][c]) continue;
            eligible.push({ c, r });
          }
        }
        shuffle(eligible);

        const placed = [];
        // Keep spiders apart: Chebyshev distance >= 2 from each other.
        for (const cell of eligible) {
          if (placed.length >= count) break;
          if (placed.some((p) => chebyshev(p, cell) < 2)) continue;
          placed.push(cell);
        }
        // Fallback if we couldn't space them out enough.
        if (placed.length < count) {
          for (const cell of eligible) {
            if (placed.length >= count) break;
            if (placed.some((p) => p.c === cell.c && p.r === cell.r)) continue;
            placed.push(cell);
          }
        }
        state.spiders = placed.map(({ c, r }) => ({
          c, r,
          alive: true,
          // All initial spawns are adults. Baby fields stay defined so render
          // and AI can branch consistently without optional-chaining everywhere.
          isBaby: false,
          babyTurnsLeft: 0,
          justBorn: false,
        }));
      }

      function placeWeapons() {
        const eligible = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (isInOrOut(c, r)) continue;
            if (chebyshev({ c, r }, IN_CELL) < 2) continue;
            if (state.env[r][c] !== 'neutral') continue;
            if (state.spiders.some((s) => s.c === c && s.r === r)) continue;
            eligible.push({ c, r });
          }
        }
        shuffle(eligible);
        const placed = [];
        // Keep weapons apart from each other (Chebyshev >= 2).
        for (const cell of eligible) {
          if (placed.length >= WEAPON_COUNT) break;
          if (placed.some((p) => chebyshev(p, cell) < 2)) continue;
          placed.push(cell);
        }
        for (const { c, r } of placed) {
          state.weapons[r][c] = true;
        }
      }

      // Invisibility Potion chests. Visually identical to weapon chests on the
      // board; the player only learns which they got at pickup time.
      function placePotions() {
        const eligible = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (isInOrOut(c, r)) continue;
            if (chebyshev({ c, r }, IN_CELL) < 2) continue;
            if (state.env[r][c] !== 'neutral') continue;
            if (state.spiders.some((s) => s.c === c && s.r === r)) continue;
            if (state.weapons[r][c]) continue; // never stack with a weapon chest
            eligible.push({ c, r });
          }
        }
        shuffle(eligible);
        const placed = [];
        // Keep potions apart from each other and from weapon chests (Chebyshev >= 2).
        for (const cell of eligible) {
          if (placed.length >= POTION_COUNT) break;
          if (placed.some((p) => chebyshev(p, cell) < 2)) continue;
          // Keep some breathing room from the visually-identical weapon chests too.
          let nearWeapon = false;
          for (let rr = 0; rr < ROWS && !nearWeapon; rr++) {
            for (let cc = 0; cc < COLS && !nearWeapon; cc++) {
              if (state.weapons[rr][cc] && chebyshev({ c: cc, r: rr }, cell) < 2) {
                nearWeapon = true;
              }
            }
          }
          if (nearWeapon) continue;
          placed.push(cell);
        }
        for (const { c, r } of placed) {
          state.potions[r][c] = true;
        }
      }

      // ── Effect handlers ──────────────────────────────────────────────────
      function applyEffectOnCurrentCell(p, dir) {
        const envKey = state.env[p.r][p.c];
        const def = ENV_TYPES[envKey];
        if (def && typeof def.onEnter === 'function') {
          def.onEnter(p, dir);
        }
      }

      // Sliding into a portal cell AUTO-TELEPORTS the player to the partner
      // portal and the slide continues on the partner side in the partner's
      // outward bar direction (i.e. as if the partner portal itself launched
      // the slide). Outside of slides, the exit-via-bar rule still applies:
      // a player who is on a portal cell at the START of their turn must
      // choose a movement in the portal's bar direction to teleport (handled
      // in legalMoves + movePlayer).
      function handleSlide(p, dir) {
        if (!dir || (dir.dc === 0 && dir.dr === 0)) return;
        if (!state.pendingPath) state.pendingPath = [{ c: p.c, r: p.r }];
        // Hard cap to avoid any pathological loop.
        for (let step = 0; step < ROWS + COLS; step++) {
          const nc = p.c + dir.dc;
          const nr = p.r + dir.dr;
          if (!inBounds(nc, nr)) return;            // hit edge: stop on current
          // Wall (or boulder — boulders block all departures and entries)
          // stops the slide on the current cell.
          if (isWallTraversalBlocked(p.c, p.r, dir.dc, dir.dr)) return;
          // Rock blocks the slide too: stop on current cell. Slides do NOT
          // push rocks (only player traverse moves do).
          if (state.rocks[nr][nc]) return;
          // Locked cell stops the slide one cell short. Slides cannot use
          // keys, BUT a Button that's currently holding the lock open lets
          // the slide continue through (no key spent — buttons override).
          if (state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr)) return;
          // step onto next cell
          p.c = nc; p.r = nr;
          state.pendingPath.push({ c: nc, r: nr });
          // Spider collision on the intermediate cell. If it kills the
          // player, the slide ends here.
          resolveSpidersOnPlayer(p);
          if (p.status !== 'on-grid') return;
          // OUT does NOT stop a slide — the slide passes through. The exit
          // check in finalizeMove only triggers if the slide *ends* on OUT.
          const envKey = state.env[nr][nc];
          if (envKey === 'slide') {
            // Reached another slide cell: stop here. The player will pick a new
            // slide direction on their next turn.
            return;
          }
          if (isPortalKey(envKey)) {
            // Slide into a portal: teleport ONLY if the slide direction
            // matches the portal's bar direction (i.e. the slide would
            // exit this cell through the dashed bar). Otherwise the
            // portal acts as a neutral cell — the slide passes through
            // without teleporting. Same exit-via-bar rule as a normal
            // step move.
            const portalBar = state.portalDirs[nr] && state.portalDirs[nr][nc];
            const exitMatchesBar =
              portalBar && portalBar.dc === dir.dc && portalBar.dr === dir.dr;
            if (exitMatchesBar) {
              const partner = getPartnerPortal(nc, nr);
              const partnerBar = partner && state.portalDirs[partner.r][partner.c];
              if (!partner || !partnerBar) {
                // No partner / partner missing a bar: stop on the portal cell.
                return;
              }
              // If a rock is resting on the partner cell, bump it off
              // in the emerge direction (opposite the partner's bar)
              // before the player lands. If the bump destination is
              // blocked, the slide ends on THIS portal cell (the
              // entry portal) — the player can't safely emerge.
              if (state.rocks[partner.r] && state.rocks[partner.r][partner.c]) {
                const emergeDir = { dc: -partnerBar.dc, dr: -partnerBar.dr };
                if (!canPushRock(partner.c, partner.r, emergeDir.dc, emergeDir.dr)) {
                  return;
                }
                const ec = partner.c + emergeDir.dc, er = partner.r + emergeDir.dr;
                if (!inBounds(ec, er)) return;
                state.rocks[partner.r][partner.c] = false;
                state.rocks[er][ec] = true;
                resolveRockArrival(ec, er, emergeDir);
              }
              p.c = partner.c; p.r = partner.r;
              state.pendingPath.push({ c: p.c, r: p.r, jump: true });
              // Spiders on the partner cell can still catch the player.
              resolveSpidersOnPlayer(p);
              if (p.status !== 'on-grid') return;
              // OUT shouldn't ever be a portal, but guard anyway.
              if (isOutCell(p.c, p.r)) return;
              // New slide direction: emerge OUTWARD from the partner's bar.
              dir = { dc: -partnerBar.dc, dr: -partnerBar.dr };
              p.lastDir = dir;
              // Resume sliding from the partner cell with the new direction.
              continue;
            }
            // Slide direction doesn't match the bar — pass through this
            // portal cell as if it were neutral and keep sliding.
            continue;
          }
          if (envKey === 'river') {
            // Rivers do NOT stop or redirect a slide. The slide's
            // momentum carries the player over the river cell in the
            // original slide direction — the current only takes effect
            // if the player ENDS their turn on a river (handled by the
            // normal river onEnter when stepping in, not while sliding).
            continue;
          }
          if (envKey !== 'neutral') {
            // Reached another effect cell: stop sliding and let that effect run once.
            // Some env types (tree, button, wall with no relevant bar)
            // have no onEnter — we still stop the slide here, but skip
            // the effect call so we don't crash on null.
            const def = ENV_TYPES[envKey];
            if (def && typeof def.onEnter === 'function') {
              def.onEnter(p, dir);
            }
            return;
          }
          // else neutral cell: keep sliding
        }
      }

      // River: a directional current. Each river cell carries its own flow
      // direction in state.riverDirs[r][c]; the river ignores the player's
      // entry direction and pushes them through whatever direction this
      // cell is set to. If the next cell is also a river, the flow
      // continues with that cell's direction (so chains can turn corners).
      // Stops on: non-river cell (and triggers that cell's onEnter, like a
      // slide does); board edge; wall/boulder; rock; locked cell. The
      // entry-direction `dir` arg is unused except for downstream effects
      // that need a non-zero facing — we synthesize one from the river's
      // own flow direction for those.
      function handleRiver(p, _entryDir) {
        if (!state.pendingPath) state.pendingPath = [{ c: p.c, r: p.r }];
        // Hard cap to avoid any pathological loop (e.g. river cells that
        // form a closed loop — the player would otherwise spin forever).
        const SEEN_CAP = ROWS * COLS;
        const seen = new Set();
        for (let step = 0; step < SEEN_CAP; step++) {
          const k = p.c + ',' + p.r;
          if (seen.has(k)) return;             // closed loop: stop on current
          seen.add(k);
          const flow = state.riverDirs[p.r] && state.riverDirs[p.r][p.c];
          if (!flow) return;                   // current cell isn't a (configured) river
          const nc = p.c + flow.dc;
          const nr = p.r + flow.dr;
          if (!inBounds(nc, nr)) return;       // hit edge: stop on current
          if (isWallTraversalBlocked(p.c, p.r, flow.dc, flow.dr)) return;
          if (state.rocks[nr][nc]) return;     // rocks block; rivers don't push them
          // Locks block, and rivers can't spend keys — but a Button holding
          // the lock open lets the flow continue (no key consumed).
          if (state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr)) return;
          // step onto next cell
          p.c = nc; p.r = nr;
          p.lastDir = { dc: flow.dc, dr: flow.dr };
          state.pendingPath.push({ c: nc, r: nr });
          resolveSpidersOnPlayer(p);
          if (p.status !== 'on-grid') return;
          // OUT does NOT stop a river — the flow passes through. The exit
          // check in finalizeMove only triggers if the flow *ends* on OUT,
          // matching slide behavior.
          const envKey = state.env[nr][nc];
          if (envKey === 'river') {
            // Chain — next iteration picks up this cell's flow direction.
            continue;
          }
          if (envKey !== 'neutral') {
            // Reached another effect cell: hand off to its onEnter and stop.
            // Same null guard as handleSlide — tree / button / inert
            // wall cells stop the river without invoking a missing
            // onEnter handler.
            const def = ENV_TYPES[envKey];
            if (def && typeof def.onEnter === 'function') {
              def.onEnter(p, { dc: flow.dc, dr: flow.dr });
            }
            return;
          }
          // else neutral cell: river ends here.
          return;
        }
      }

      // Generic river-chain walker for non-player entities (spiders, rocks).
      // The caller passes the entity (any { c, r }-shaped object), a
      // blocker predicate, and an optional per-step callback. The helper
      // mutates `entity.c` / `entity.r` in place and stops when the
      // current cell is no longer a river, when the next step would hit
      // a board edge / wall bar / caller-defined blocker, when the
      // chain loops back on itself, or when `onStep` returns true (use
      // that to halt for lava/tnt/collision side-effects). Mirrors the
      // body of handleRiver minus all player-specific state (pendingPath,
      // OUT-cell handling, spider chase resolution, ENV_TYPES dispatch).
      //
      // The on-cell effect callback runs AFTER the entity has stepped
      // onto the new cell, so the callback sees the freshly-updated
      // position. If the callback returns true the chain stops AT the
      // new cell — use that for lava-kill / tnt-detonation / collision
      // halts that the caller wants to apply at the final resting cell.
      function flowAlongRiver(entity, isBlocked, onStep) {
        const SEEN_CAP = ROWS * COLS;
        const seen = new Set();
        for (let step = 0; step < SEEN_CAP; step++) {
          if (state.env[entity.r][entity.c] !== 'river') return;
          const k = entity.c + ',' + entity.r;
          if (seen.has(k)) return;
          seen.add(k);
          const flow = state.riverDirs[entity.r] && state.riverDirs[entity.r][entity.c];
          if (!flow) return;
          const nc = entity.c + flow.dc, nr = entity.r + flow.dr;
          if (!inBounds(nc, nr)) return;
          if (isWallTraversalBlocked(entity.c, entity.r, flow.dc, flow.dr)) return;
          if (isBlocked && isBlocked(nc, nr, flow)) return;
          entity.c = nc; entity.r = nr;
          if (onStep && onStep(entity, flow)) return;
        }
      }

      // Knight: jump 2 forward + 1 to the right of facing. Skips intermediate cells.
      // Right of facing in screen coords (y-down): rotate (dc, dr) 90° CW -> (-dr, dc).
      // Boulders block the landing as well — the knight cannot land on a
      // boulder cell. (Walls with all 4 sides blocked DO permit a landing,
      // even though the player will then be soft-locked there.)
      function handleKnight(p, dir) {
        if (!dir || (dir.dc === 0 && dir.dr === 0)) return;
        const right = { dc: -dir.dr, dr: dir.dc };
        const nc = p.c + 2 * dir.dc + right.dc;
        const nr = p.r + 2 * dir.dr + right.dr;
        if (!inBounds(nc, nr)) return;                          // off-grid: jump fails
        if (state.env[nr][nc] === 'boulder') return;            // boulder: jump fails
        if (state.rocks[nr][nc]) return;                        // rock: jump fails (rocks are only pushed by traverse moves)
        // Locked landing: knights cannot use a key mid-jump. The jump
        // fails — unless a Button is currently holding the lock open.
        if (state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr)) return;
        p.c = nc; p.r = nr;
        // Landing cell effect triggers (passed-over cells do not).
        if (isOutCell(nc, nr)) return;
        applyEffectOnCurrentCell(p, dir);
      }

      // Green Knight: mirror of the regular Knight. Same chess-knight
      // jump, but offset 1 to the LEFT of the travel direction instead
      // of the right. Visually identical to Knight except the glyph is
      // flipped horizontally. All blocker rules match handleKnight
      // (off-grid, boulder, rock, locked-without-button-held-open).
      function handleGreenKnight(p, dir) {
        if (!dir || (dir.dc === 0 && dir.dr === 0)) return;
        const left = { dc: dir.dr, dr: -dir.dc };
        const nc = p.c + 2 * dir.dc + left.dc;
        const nr = p.r + 2 * dir.dr + left.dr;
        if (!inBounds(nc, nr)) return;
        if (state.env[nr][nc] === 'boulder') return;
        if (state.rocks[nr][nc]) return;
        if (state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr)) return;
        p.c = nc; p.r = nr;
        if (isOutCell(nc, nr)) return;
        applyEffectOnCurrentCell(p, dir);
      }

      // Lava: kills any creature that enters. The player is sent off-grid
      // and respawned via the standard kill flow (loses weapons + invisibility,
      // -100 penalty). Spiders and rocks have separate handling at their own
      // step sites (spiders die for +10; rocks turn the lava cell into a boulder).
      function handleLava(p, dir) {
        // "SSSSS!" lava-kill flash (distinct from BOOM, which is reserved
        // for TnT explosions and spider-on-TnT collisions).
        state.pendingFx.push({ type: 'lavakill', c: p.c, r: p.r });
        killPlayer(p, 'lava');
      }

      // Purple Portal: paired teleport gate. Under the exit-via-bar rule the
      // teleport is triggered when a player on a portal cell chooses a move
      // in the portal's bar direction (see movePlayer + legalMoves) — NOT
      // when they walk onto the cell. This handler is therefore unused as an
      // ENV_TYPES.onEnter callback (registered as null) and remains here only
      // for reference / potential future hooks.
      function handlePortal(p, dir) {
        // Intentionally a no-op under the exit-via-bar rule.
      }

      // TnT: blow up the player. They are sent off-grid and the level
      // rolls back to its start state (spiders respawn, picked-up
      // chests/cakes/potions return, etc.) so the failed attempt is
      // fully undone — same flow as lava and spider deaths. Keys and
      // locks intentionally do NOT reset (see snapshot block in init()).
      function handleTnt(p, dir) {
        state.pendingFx.push({ type: 'boom', c: p.c, r: p.r });
        killPlayer(p, 'tnt');
      }

      // ── Button helpers ───────────────────────────────────────────────────
      // A Button cell activates whenever a Player or a Rock is standing on
      // it. Spiders, knights, boulders, and other entities do NOT trigger
      // a button. Each button keeps a list of target cells; depending on
      // what is on the target at trigger time the button either:
      //   • detonates a TnT (edge-triggered, one-shot — fires once per
      //     OFF→ON transition and consumes the TnT), or
      //   • holds a Lock open while the button is ON (level-triggered —
      //     the lock blocks again as soon as the button releases).
      // No-op silently for any other target contents.

      // True if any player or rock is currently on (c, r). Pure check —
      // no side effects, safe to call from render() and movement validators.
      function isButtonPressed(c, r) {
        if (state.rocks[r] && state.rocks[r][c]) return true;
        for (const p of state.players) {
          if (p.status === 'on-grid' && p.c === c && p.r === r) return true;
        }
        return false;
      }

      // True if the lock at (c, r) is currently held open by any pressed
      // button wired to that cell. Called by movement code as a virtual
      // override on top of state.locks[r][c] — the lock layer itself is
      // never mutated by buttons, so the lock returns to blocking the
      // moment the button releases.
      function isLockHeldOpenByButton(c, r) {
        if (!state.locks[r] || !state.locks[r][c]) return false;
        for (const b of state.buttons) {
          if (!isButtonPressed(b.c, b.r)) continue;
          for (const t of b.targets) {
            if (t.c === c && t.r === r) return true;
          }
        }
        return false;
      }

      // Detonate (c, r): pop the BOOM fx, consume any TnT env on the cell,
      // clear any rock sitting on the cell, kill any player standing on
      // the cell (via killPlayer), and wipe out any spiders on the cell.
      // Used by button-triggered TnT effects so the explosion has the
      // same semantics as a direct rock-into-TnT detonation. Safe to call
      // even if the cell has no TnT (the cleanup still runs harmlessly,
      // but ideally callers gate on env==='tnt' so the BOOM fx isn't
      // spammed on empty cells).
      function detonateAtCell(c, r) {
        if (!inBounds(c, r)) return;
        state.pendingFx.push({ type: 'boom', c, r });
        if (state.env[r] && state.env[r][c] === 'tnt') {
          state.env[r][c] = 'neutral';
        }
        if (state.rocks[r] && state.rocks[r][c]) {
          state.rocks[r][c] = false;
        }
        for (const p of state.players) {
          if (p.status === 'on-grid' && p.c === c && p.r === r) {
            killPlayer(p, 'tnt');
          }
        }
        for (const s of state.spiders) {
          if (s.alive && s.c === c && s.r === r) {
            s.alive = false;
          }
        }
      }

      // Recompute every button's pressed state and fire one-shot effects on
      // OFF→ON transitions. Called from finalizeMove() AFTER the player has
      // committed their move (and any rock pushes have resolved) but BEFORE
      // the spider phase, so a button press registers immediately at the
      // end of the player's turn. Lock effects are level-triggered and do
      // not need any work here — they're queried virtually via
      // isLockHeldOpenByButton at movement-validation time.
      function processButtonPresses() {
        if (!state.buttons || !state.buttons.length) return;
        for (const b of state.buttons) {
          const nowOn = isButtonPressed(b.c, b.r);
          const wasOn = !!b._on;
          if (nowOn && !wasOn) {
            // OFF → ON: fire edge-triggered TnT effects against every
            // target cell that currently has TnT on it. Lock targets are
            // a no-op here for gameplay (their "held open" behavior is
            // read-only), but we still queue a 'lock-lift' fx so the
            // cage's bars visibly retract on this render.
            for (const t of b.targets) {
              if (!inBounds(t.c, t.r)) continue;
              if (state.env[t.r] && state.env[t.r][t.c] === 'tnt') {
                detonateAtCell(t.c, t.r);
              }
              if (state.locks[t.r] && state.locks[t.r][t.c]) {
                state.pendingFx.push({ type: 'lock-lift', c: t.c, r: t.r });
              }
            }
          } else if (!nowOn && wasOn) {
            // ON → OFF: queue a 'lock-drop' fx on every still-locked
            // target so the cage's bars visibly descend back into place.
            // TnT targets need no release effect (their detonation is
            // one-shot and irreversible).
            for (const t of b.targets) {
              if (!inBounds(t.c, t.r)) continue;
              if (state.locks[t.r] && state.locks[t.r][t.c]) {
                state.pendingFx.push({ type: 'lock-drop', c: t.c, r: t.r });
              }
            }
          }
          b._on = nowOn;
        }
      }

      // Sync each button's `_on` baseline to whatever the current
      // pressed/released state is, WITHOUT firing any effects. Used at
      // level start (after layout apply) and after a death-respawn so
      // that a rock-on-button at level start doesn't re-detonate its TnT
      // target every time the player respawns.
      function rebaselineButtons() {
        if (!state.buttons || !state.buttons.length) return;
        for (const b of state.buttons) {
          b._on = isButtonPressed(b.c, b.r);
        }
      }

      // ── Min-turns BFS ────────────────────────────────────────────────────
      // Compute the minimum number of turns a single player would need to
      // travel from off-grid (level start) to OUT. Used to display a "Min
      // N" floor next to the running turn counter and as the gate for the
      // slow-clear penalty.
      //
      // Searches the full mutable state space:
      //   • Player position (off-grid + 100 cells)
      //   • Rocks (pushable; destroyed by lava-fill or tnt-detonation)
      //   • Env (lava → boulder when filled; tnt → neutral when detonated)
      //   • Keys on the floor (consumed when picked up)
      //   • Locks on the board (consumed when unlocked with a key)
      //   • Player's key inventory count
      //
      // Spiders are still ignored (modeled as if the player walks the
      // optimum unimpeded). Other players, weapons, potions, cakes, and
      // sandlot all ignored — none of them gate the path to OUT.
      //
      // Returns a positive integer turn count, '?' for randomized levels
      // (level 9+) or for searches that exceed the safety cap, or null if
      // OUT is unreachable.
      function computeMinTurnsToOut() {
        // Cache: the search is expensive on rock+lock heavy levels (Level 7
        // can take >1s) and the result only changes when the level layout
        // changes — not on every player move. init() invalidates the cache
        // by setting state._minTurnsCache = null, and Edit Mode does the
        // same after each cell tweak.
        if (state._minTurnsCache && state._minTurnsCache.level === state.level) {
          return state._minTurnsCache.value;
        }
        const value = computeMinTurnsToOutUncached();
        state._minTurnsCache = { level: state.level, value };
        return value;
      }
      function computeMinTurnsToOutUncached() {
        // Layouts flagged complexBfs have rock+lock (or portal+rock+lock)
        // interactions that blow up the search space (hundreds of
        // thousands of states with the BFS we run on the main thread).
        // Rather than make the player wait, we surface a '?' for those
        // levels — the slow-clear penalty is also gated off when
        // minTurns isn't a number, which is what we want here.
        if (getLayout(state.level)?.complexBfs) return '?';
        // Buttons aren't modeled by the BFS — wired TnT detonations,
        // lock-hold-open passthroughs, and edge-triggered effects would
        // each multiply the state space. Custom layouts with buttons
        // get '?' until the BFS learns to handle them.
        if (state.buttons && state.buttons.length) return '?';
        const N = ROWS * COLS;
        const idx = (c, r) => r * COLS + c;
        // Snapshot the level's mutable layers as flat arrays. The BFS
        // simulates moves against copies of these — never the live state.
        const startEnv   = new Array(N);
        const startRocks = new Array(N);
        const startKeys  = new Array(N);
        const startLocks = new Array(N);
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const i = idx(c, r);
            startEnv[i]   = state.env[r][c];
            startRocks[i] = !!state.rocks[r][c];
            startKeys[i]  = !!state.keys[r][c];
            startLocks[i] = !!state.locks[r][c];
          }
        }
        // Encode a search state as a string for the visited set. Layers
        // are stored as sorted index lists rather than full bitmaps,
        // which keeps keys short on levels where most cells never change
        // (almost all of them). Env is diff-encoded against startEnv.
        function encode(pos, env, rocks, keys, locks, pkeys) {
          let s = (pos === 'X') ? 'X' : (pos.c + 'x' + pos.r);
          let envDiff = '', rocksList = '', keysList = '', locksList = '';
          for (let i = 0; i < N; i++) {
            if (env[i] !== startEnv[i]) envDiff += i + ':' + env[i].charAt(0) + ',';
            if (rocks[i]) rocksList += i + ',';
            if (keys[i]) keysList += i + ',';
            if (locks[i]) locksList += i + ',';
          }
          return s + '|' + envDiff + '|' + rocksList + '|' + keysList + '|' + locksList + '|' + pkeys;
        }
        // Wall-traversal check using simulated env (so a lava-filled
        // boulder cell blocks like a wall). Mirrors isWallTraversalBlocked.
        function isWallBlockedSim(fromC, fromR, dc, dr, env) {
          if (env[idx(fromC, fromR)] === 'boulder') return true;
          const fromWalls = state.wallDirs[fromR] && state.wallDirs[fromR][fromC];
          if (fromWalls && fromWalls.some(w => w.dc === dc && w.dr === dr)) return true;
          const toC = fromC + dc, toR = fromR + dr;
          if (toR < 0 || toR >= ROWS || toC < 0 || toC >= COLS) return false;
          if (env[idx(toC, toR)] === 'boulder') return true;
          const toWalls = state.wallDirs[toR] && state.wallDirs[toR][toC];
          if (toWalls && toWalls.some(w => w.dc === -dc && w.dr === -dr)) return true;
          return false;
        }
        // onEnter resolution using simulated layers.
        function onEnterSim(c, r, dir, env, rocks, locks, depth) {
          if (depth > ROWS + COLS) return { c, r };
          if (isOutCell(c, r)) return 'EXIT';
          const e = env[idx(c, r)];
          if (e === 'knight') {
            const right = { dc: -dir.dr, dr: dir.dc };
            const nc = c + 2 * dir.dc + right.dc;
            const nr = r + 2 * dir.dr + right.dr;
            if (!inBounds(nc, nr)) return { c, r };
            if (env[idx(nc, nr)] === 'boulder') return { c, r };
            if (rocks[idx(nc, nr)]) return { c, r };
            if (isOutCell(nc, nr)) return 'EXIT';
            return onEnterSim(nc, nr, dir, env, rocks, locks, depth + 1);
          }
          if (e === 'green-knight') {
            // Mirror of the knight branch: offset 1 to the LEFT of dir.
            const left = { dc: dir.dr, dr: -dir.dc };
            const nc = c + 2 * dir.dc + left.dc;
            const nr = r + 2 * dir.dr + left.dr;
            if (!inBounds(nc, nr)) return { c, r };
            if (env[idx(nc, nr)] === 'boulder') return { c, r };
            if (rocks[idx(nc, nr)]) return { c, r };
            if (isOutCell(nc, nr)) return 'EXIT';
            return onEnterSim(nc, nr, dir, env, rocks, locks, depth + 1);
          }
          if (e === 'slide') {
            return slideSim(c, r, dir.dc, dir.dr, env, rocks, locks, depth + 1);
          }
          if (e === 'river') {
            return riverSim(c, r, env, rocks, locks, depth + 1);
          }
          if (e === 'tnt' || e === 'lava') return 'OFF';
          return { c, r };
        }
        // Slide simulation using simulated layers. Mirrors handleSlide
        // minus side effects. Slides do NOT push rocks or unlock locks.
        function slideSim(startC, startR, dc, dr, env, rocks, locks, depth) {
          if (depth > 2 * (ROWS + COLS)) return { c: startC, r: startR };
          let c = startC, r = startR;
          let curDc = dc, curDr = dr;
          for (let step = 0; step < ROWS + COLS; step++) {
            const nc = c + curDc, nr = r + curDr;
            if (!inBounds(nc, nr)) return { c, r };
            if (isWallBlockedSim(c, r, curDc, curDr, env)) return { c, r };
            if (rocks[idx(nc, nr)]) return { c, r };
            if (locks[idx(nc, nr)]) return { c, r };
            c = nc; r = nr;
            if (isOutCell(c, r)) return 'EXIT';
            const e = env[idx(c, r)];
            if (e === 'slide') return { c, r };
            if (isPortalKey(e)) {
              const portalBar = state.portalDirs[r] && state.portalDirs[r][c];
              const exitMatchesBar =
                portalBar && portalBar.dc === curDc && portalBar.dr === curDr;
              if (exitMatchesBar) {
                const partner = getPartnerPortal(c, r);
                const partnerBar = partner && state.portalDirs[partner.r][partner.c];
                if (!partner || !partnerBar) return { c, r };
                c = partner.c; r = partner.r;
                if (isOutCell(c, r)) return 'EXIT';
                curDc = -partnerBar.dc; curDr = -partnerBar.dr;
                continue;
              }
              continue;
            }
            if (e !== 'neutral') {
              return onEnterSim(c, r, { dc: curDc, dr: curDr }, env, rocks, locks, depth + 1);
            }
            // else neutral cell — keep sliding.
          }
          return { c, r };
        }
        // River simulation using simulated layers. Mirrors handleRiver
        // minus side effects: each river cell dictates its own flow
        // direction (read from state.riverDirs), chains across river
        // cells (each contributing its own direction so chains can
        // turn), and stops on any non-river effect cell (handing off to
        // its onEnter), edge, wall/boulder, rock, or lock. River cannot
        // push rocks or unlock locks.
        function riverSim(startC, startR, env, rocks, locks, depth) {
          if (depth > 2 * (ROWS + COLS)) return { c: startC, r: startR };
          let c = startC, r = startR;
          const seen = new Set();
          for (let step = 0; step < ROWS * COLS; step++) {
            const k = c + ',' + r;
            if (seen.has(k)) return { c, r };
            seen.add(k);
            const flow = state.riverDirs[r] && state.riverDirs[r][c];
            if (!flow) return { c, r };
            const nc = c + flow.dc, nr = r + flow.dr;
            if (!inBounds(nc, nr)) return { c, r };
            if (isWallBlockedSim(c, r, flow.dc, flow.dr, env)) return { c, r };
            if (rocks[idx(nc, nr)]) return { c, r };
            if (locks[idx(nc, nr)]) return { c, r };
            c = nc; r = nr;
            if (isOutCell(c, r)) return 'EXIT';
            const e = env[idx(c, r)];
            if (e === 'river') continue;  // chain through next river cell's direction
            if (e !== 'neutral') {
              return onEnterSim(c, r, { dc: flow.dc, dr: flow.dr }, env, rocks, locks, depth + 1);
            }
            return { c, r };
          }
          return { c, r };
        }
        // BFS proper. Index-based queue keeps dequeue O(1).
        const queue = [];
        let head = 0;
        const visited = new Set();
        visited.add(encode('X', startEnv, startRocks, startKeys, startLocks, 0));
        queue.push({
          pos: 'X',
          env: startEnv, rocks: startRocks, keys: startKeys, locks: startLocks,
          pkeys: 0, d: 0,
        });
        // Hard cap. Levels that survive the early gate (0–6) explore at
        // most a few thousand states, so 50k is generous headroom and
        // keeps the search from ever stalling the UI.
        let safety = 50000;
        while (head < queue.length && safety-- > 0) {
          const cur = queue[head++];
          // Off-grid: only legal action is enter via IN. The IN cell is
          // always neutral (no onEnter resolution); pickups still apply
          // if a key happens to sit on IN.
          if (cur.pos === 'X') {
            const ic = IN_CELL.c, ir = IN_CELL.r;
            let nextKeys = cur.keys, nextPkeys = cur.pkeys;
            if (cur.keys[idx(ic, ir)]) {
              nextKeys = cur.keys.slice();
              nextKeys[idx(ic, ir)] = false;
              nextPkeys += 1;
            }
            const nextPos = { c: ic, r: ir };
            const k = encode(nextPos, cur.env, cur.rocks, nextKeys, cur.locks, nextPkeys);
            if (!visited.has(k)) {
              visited.add(k);
              queue.push({
                pos: nextPos,
                env: cur.env, rocks: cur.rocks, keys: nextKeys, locks: cur.locks,
                pkeys: nextPkeys, d: cur.d + 1,
              });
            }
            continue;
          }
          // On-grid.
          const c = cur.pos.c, r = cur.pos.r;
          // On-river: the river dictates the move. Player has exactly one
          // forced successor (or none, if the flow is blocked) — skip the
          // 4-way for-loop entirely.
          if (cur.env[idx(c, r)] === 'river') {
            const flow = state.riverDirs[r] && state.riverDirs[r][c];
            if (flow) {
              const dest = riverSim(c, r, cur.env, cur.rocks, cur.locks, 0);
              if (dest === 'EXIT') return cur.d + 1;
              let nextPos, nextKeys = cur.keys, nextPkeys = cur.pkeys;
              if (dest === 'OFF') {
                nextPos = 'X';
              } else {
                nextPos = dest;
                if (cur.keys[idx(dest.c, dest.r)]) {
                  nextKeys = cur.keys.slice();
                  nextKeys[idx(dest.c, dest.r)] = false;
                  nextPkeys += 1;
                }
              }
              const k = encode(nextPos, cur.env, cur.rocks, nextKeys, cur.locks, nextPkeys);
              if (!visited.has(k)) {
                visited.add(k);
                queue.push({
                  pos: nextPos,
                  env: cur.env, rocks: cur.rocks, keys: nextKeys, locks: cur.locks,
                  pkeys: nextPkeys, d: cur.d + 1,
                });
              }
            }
            continue;
          }
          const onSlide  = cur.env[idx(c, r)] === 'slide';
          const onPortal = isPortalKey(cur.env[idx(c, r)]);
          const portalBar = onPortal ? state.portalDirs[r][c] : null;
          const partner = (onPortal && portalBar) ? getPartnerPortal(c, r) : null;
          for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            // Portal teleport via bar direction.
            if (portalBar && partner && dc === portalBar.dc && dr === portalBar.dr) {
              if (isOutCell(partner.c, partner.r)) return cur.d + 1;
              const dest = onEnterSim(partner.c, partner.r, { dc, dr }, cur.env, cur.rocks, cur.locks, 0);
              if (dest === 'EXIT') return cur.d + 1;
              let nextPos, nextKeys = cur.keys, nextPkeys = cur.pkeys;
              if (dest === 'OFF') {
                nextPos = 'X';
              } else {
                nextPos = dest;
                if (cur.keys[idx(dest.c, dest.r)]) {
                  nextKeys = cur.keys.slice();
                  nextKeys[idx(dest.c, dest.r)] = false;
                  nextPkeys += 1;
                }
              }
              const k = encode(nextPos, cur.env, cur.rocks, nextKeys, cur.locks, nextPkeys);
              if (!visited.has(k)) {
                visited.add(k);
                queue.push({
                  pos: nextPos,
                  env: cur.env, rocks: cur.rocks, keys: nextKeys, locks: cur.locks,
                  pkeys: nextPkeys, d: cur.d + 1,
                });
              }
              continue;
            }
            const nc = c + dc, nr = r + dr;
            if (!inBounds(nc, nr)) continue;
            if (isWallBlockedSim(c, r, dc, dr, cur.env)) continue;
            let dest;
            let nextEnv = cur.env, nextRocks = cur.rocks, nextLocks = cur.locks;
            let nextPkeys = cur.pkeys;
            if (onSlide) {
              // Slide-start: cannot push rocks (a rock-adjacent direction
              // is illegal, matching legalMoves). Slides also don't unlock
              // cells — slideSim will stop at any lock encountered.
              if (cur.rocks[idx(nc, nr)]) continue;
              dest = slideSim(c, r, dc, dr, cur.env, cur.rocks, cur.locks, 0);
            } else {
              // Lock at target cell consumes one key from inventory.
              if (cur.locks[idx(nc, nr)]) {
                if (cur.pkeys <= 0) continue;
                nextLocks = cur.locks.slice();
                nextLocks[idx(nc, nr)] = false;
                nextPkeys -= 1;
              }
              // Rock at target: try to push it one cell further in the
              // same direction. Mirrors canPushRock + resolveRockArrival.
              if (cur.rocks[idx(nc, nr)]) {
                const tc = nc + dc, tr = nr + dr;
                if (!inBounds(tc, tr)) continue;
                if (isInOrOut(tc, tr)) continue;
                if (isWallBlockedSim(nc, nr, dc, dr, cur.env)) continue;
                const ti = idx(tc, tr);
                if (cur.rocks[ti]) continue;             // no chain pushing
                if (cur.locks[ti]) continue;             // can't push into a lock
                if (cur.env[ti] === 'boulder') continue;
                if (cur.env[ti] === 'tree') continue;    // trees block rock pushes too
                nextRocks = cur.rocks.slice();
                nextRocks[idx(nc, nr)] = false;
                if (cur.env[ti] === 'lava') {
                  // Rock fills lava → permanent boulder; rock destroyed.
                  nextEnv = cur.env.slice();
                  nextEnv[ti] = 'boulder';
                } else if (cur.env[ti] === 'tnt') {
                  // Rock detonates tnt → both consumed, cell neutral.
                  nextEnv = cur.env.slice();
                  nextEnv[ti] = 'neutral';
                } else if (isPortalKey(cur.env[ti])) {
                  // Portal: if the push direction matches the portal's
                  // bar, the rock teleports to the partner portal cell
                  // (mirrors canPushRock + resolveRockArrival). When
                  // the bar doesn't match (or there's no partner), the
                  // rock just rests on the entry portal cell.
                  const portalBar = state.portalDirs[tr] && state.portalDirs[tr][tc];
                  const exitMatchesBar =
                    portalBar && portalBar.dc === dc && portalBar.dr === dr;
                  const partner = exitMatchesBar ? getPartnerPortal(tc, tr) : null;
                  const partnerBar = partner && state.portalDirs[partner.r][partner.c];
                  if (partner && partnerBar) {
                    const pi = idx(partner.c, partner.r);
                    if (isInOrOut(partner.c, partner.r)) continue;
                    if (cur.rocks[pi]) continue;
                    if (cur.locks[pi]) continue;
                    const pEnv = cur.env[pi];
                    if (pEnv === 'tree' || pEnv === 'boulder') continue;
                    nextRocks[pi] = true;
                  } else {
                    nextRocks[ti] = true;
                  }
                } else {
                  nextRocks[ti] = true;
                }
              }
              if (isOutCell(nc, nr)) return cur.d + 1;
              dest = onEnterSim(nc, nr, { dc, dr }, nextEnv, nextRocks, nextLocks, 0);
            }
            if (dest === 'EXIT') return cur.d + 1;
            let nextPos, nextKeys = cur.keys;
            if (dest === 'OFF') {
              nextPos = 'X';
            } else {
              nextPos = dest;
              // Pick up a key sitting at the player's final resting cell.
              if (cur.keys[idx(dest.c, dest.r)]) {
                nextKeys = cur.keys.slice();
                nextKeys[idx(dest.c, dest.r)] = false;
                nextPkeys += 1;
              }
            }
            const k = encode(nextPos, nextEnv, nextRocks, nextKeys, nextLocks, nextPkeys);
            if (!visited.has(k)) {
              visited.add(k);
              queue.push({
                pos: nextPos,
                env: nextEnv, rocks: nextRocks, keys: nextKeys, locks: nextLocks,
                pkeys: nextPkeys, d: cur.d + 1,
              });
            }
          }
        }
        // Search exhausted: cap reached → '?', otherwise unreachable → null.
        return safety <= 0 ? '?' : null;
      }

      // ── Spider AI ─────────────────────────────────────────────────────────
      // BFS shortest-path from start to end. Spiders cannot path through
      // walls (or boulders, which isWallTraversalBlocked treats as fully
      // blocked) and cannot enter IN or OUT cells, so the BFS expansion
      // skips any neighbor that fails either check. Returns the array of
      // step coords (excluding start), or null if unreachable.
      function bfsPath(start, end) {
        if (!start || !end) return null;
        if (start.c === end.c && start.r === end.r) return [];
        const key = (c, r) => `${c},${r}`;
        const visited = new Set([key(start.c, start.r)]);
        const queue = [{ c: start.c, r: start.r, path: [] }];
        while (queue.length) {
          const cur = queue.shift();
          for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nc = cur.c + dc;
            const nr = cur.r + dr;
            if (!inBounds(nc, nr)) continue;
            const k = key(nc, nr);
            if (visited.has(k)) continue;
            // Spiders cannot enter IN or OUT cells.
            if (isInOrOut(nc, nr)) continue;
            // Spiders cannot enter rock cells (rocks are only displaced by
            // players, not by spider movement).
            if (state.rocks[nr][nc]) continue;
            // Spiders cannot enter locked cells (no entity can) — but a
            // Button holding the lock open lets spiders cross too.
            if (state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr)) continue;
            // Walls (and boulders) block traversal across this edge.
            if (isWallTraversalBlocked(cur.c, cur.r, dc, dr)) continue;
            visited.add(k);
            const nextPath = cur.path.concat([{ c: nc, r: nr }]);
            if (nc === end.c && nr === end.r) return nextPath;
            queue.push({ c: nc, r: nr, path: nextPath });
          }
        }
        return null;
      }

      function nearestPlayerForSpider(spider) {
        let bestPath = null;
        let bestPlayer = null;
        for (const p of state.players) {
          if (p.status !== 'on-grid') continue;
          const path = bfsPath(spider, p);
          if (!path) continue;
          if (!bestPath || path.length < bestPath.length) {
            bestPath = path;
            bestPlayer = p;
          }
        }
        return { path: bestPath, player: bestPlayer };
      }

      // Player loses everything they were carrying. Sent back off-grid.
      // The turn counter keeps counting (no reset), but the spiders snap back
      // to their level-start positions — handled by finalizeMove after the
      // spider phase completes (so we don't mutate the spider list mid-loop).
      // Getting eaten also costs the player 100 points.
      //
      // `cause` distinguishes the death source so we don't stack visual
      // effects: spider catches show "EATEN!" here; lava deaths render their
      // own "SSSSS!" flash at the call site (handleLava) and skip this one;
      // tnt deaths render their own "BOOM" flash at the call site (handleTnt)
      // and likewise skip the eaten flash. The score-log line also reflects
      // the cause.
      function killPlayer(p, cause = 'spider') {
        if (cause !== 'lava' && cause !== 'tnt') {
          state.pendingFx.push({ type: 'eaten', c: p.c, r: p.r });
        }
        const reason = cause === 'lava'
          ? 'Burned alive in lava'
          : cause === 'tnt'
            ? 'Blown up by TnT'
            : `Eaten by a ${wormify('spider')}`;
        addScore(-100, reason);
        p.c = null; p.r = null;
        p.status = 'off-grid';
        p.lastDir = { dc: 0, dr: 0 };
        p.skipNext = false;
        p.weapons = 0;
        p.invisibleTurnsLeft = 0;
        state.respawnSpidersFlag = true;
      }

      // Player is invisible-by-tree if they are standing on a tree cell.
      // The canopy hides them from spiders — spiders won't pick them as
      // chase targets, and a spider on the same cell won't collide with
      // them. Spiders CAN enter tree cells (they just can't see what's
      // hiding underneath).
      function isPlayerOnTree(p) {
        return p && p.status === 'on-grid' &&
               p.c != null && p.r != null &&
               state.env[p.r][p.c] === 'tree';
      }

      // Kill any spiders that share a cell with an arriving rock.
      // Used by resolveRockArrival (regular push + river-carry +
      // portal teleport) and by the source-portal-exit push branch in
      // movePlayer. Pushes a zap FX per kill, awards +10 per spider
      // (environmental tier — matches lava/tnt deaths). No-op when no
      // alive spider is on the cell.
      function killSpidersOnCell(c, r) {
        if (!inBounds(c, r)) return;
        for (const s of state.spiders) {
          if (!s.alive) continue;
          if (s.c !== c || s.r !== r) continue;
          s.alive = false;
          state.pendingFx.push({ type: 'zap', c, r });
          addScore(10, `${wormify('Spider')} crushed by a rock`);
        }
      }

      // Single spider ↔ player encounter on a shared cell.
      // Weapons stack: each kill consumes one knife from the player's stack.
      function resolveCollision(player, spider) {
        if (!spider.alive) return;
        // Tree canopy hides the player from spiders — even if a spider
        // ends up on the same cell, it can't see the player and the
        // collision is a no-op.
        if (isPlayerOnTree(player)) return;
        // Bonus level ("You may now pet the spiders"): spiders are
        // friendly. With no knife → pet for +100 (green hearts + label).
        // With a knife → accidentally kill for −100 (red "OW!" toast).
        // Score floor applies on −100 so the player can't dip negative.
        if (isPettingZooLevel()) {
          resolvePetOrAccident(player, spider);
          return;
        }
        if ((player.weapons || 0) > 0) {
          spider.alive = false;
          player.weapons -= 1;
          state.pendingFx.push({ type: 'zap', c: spider.c, r: spider.r });
          addScore(20, `Killed a ${wormify('spider')}`);
        } else {
          killPlayer(player);
        }
      }

      // Petting-zoo collision handler. Pet → +100 + green-heart FX +
      // one of three random labels. Accident (player holds a knife)
      // → −100 (floor at 0) + red "OW!" toast; spider dies and knife
      // is consumed (matching normal kill mechanics) so the player
      // can't keep accidentally hurting the same spider.
      const PET_LABELS = ['Awww!', 'You pet the spider!', "Who's a good spider?"];
      function resolvePetOrAccident(player, spider) {
        if (!spider.alive) return;
        if ((player.weapons || 0) > 0) {
          spider.alive = false;
          player.weapons -= 1;
          state.pendingFx.push({ type: 'ouch', c: spider.c, r: spider.r });
          // Score floor: clamp the −100 so we never push total negative.
          const delta = Math.max(-(state.score || 0), -100);
          if (delta !== 0) addScore(delta, 'OW! You hurt me!');
        } else {
          const label = PET_LABELS[Math.floor(Math.random() * PET_LABELS.length)];
          // Index drives a CSS fan-out so simultaneous pet labels on a
          // multi-step move don't pile up on top of each other.
          const slot = state.pettingFxCounter = ((state.pettingFxCounter || 0) + 1) % 6;
          state.pendingFx.push({ type: 'pet', c: spider.c, r: spider.r, label, slot });
          addScore(100, 'Pet the spider!');
        }
      }

      // After a player moves, check if any spiders are on their new cell.
      // (Loops in case a weapon kill exposes a second spider on the same cell.)
      //
      // EARLY-OUT for tree cells: resolveCollision is a no-op when the
      // player is on a tree (canopy hides them). Without the early-out,
      // the spider stays alive on the same cell and the `while (true)`
      // loop spins forever — the page freezes and the player visibly
      // "stops" mid-turn. Spiders CAN wander onto tree cells, so a
      // player stepping onto a tree-with-spider would trigger the
      // lock-up. Returning here also matches the rule: ignore spiders
      // entirely when the player is on a tree.
      function resolveSpidersOnPlayer(player) {
        if (player.status !== 'on-grid') return;
        if (isPlayerOnTree(player)) return;
        // Petting-zoo bonus level: spider survives a pet, so a naive
        // find()-then-resolve loop would spin forever (the same spider
        // keeps matching the filter). Snapshot the on-cell spiders and
        // process each exactly once.
        if (isPettingZooLevel()) {
          const onCell = state.spiders.filter(
            (s) => s.alive && s.c === player.c && s.r === player.r
          );
          for (const sp of onCell) {
            if (!sp.alive) continue;
            resolveCollision(player, sp);
            if (player.status !== 'on-grid') return;
          }
          return;
        }
        while (true) {
          const sp = state.spiders.find(
            (s) => s.alive && s.c === player.c && s.r === player.r
          );
          if (!sp) return;
          resolveCollision(player, sp);
          if (player.status !== 'on-grid') return;
        }
      }

      // Step a single spider up to its own speed (adults SPIDER_SPEED, babies
      // BABY_SPEED). Default behavior is a random orthogonal step (in-bounds).
      // If any *visible* player is within 3 squares (Manhattan), the spider
      // chases the closest such player via BFS instead. A player is invisible
      // while their potion is active. If no eligible targets exist (e.g.
      // every on-grid player is invisible), the spider stays still. Stepping
      // onto a TnT cell explodes the spider (it dies and is removed from the
      // game).
      const SPIDER_AGGRO_RANGE = 3;
      function stepSpider(spider) {
        if (!spider.alive) return;
        // Petting-zoo bonus level: spiders ignore players entirely and
        // BFS toward the IN cell. Once a spider would step onto an
        // IN-adjacent cell (the closest cell bfsPath can actually reach,
        // since bfsPath refuses IN/OUT), the next phase emits an exit
        // FX anchored at IN and despawns the spider.
        if (isPettingZooLevel()) {
          // Stationary-grace window: for the first 10 player turns,
          // every petting-zoo spider holds its starting cell so the
          // player can stroll up and pet them at leisure. The march to
          // IN only kicks in once the player has had a chance to
          // settle in. state.turnsThisLevel ticks to 1 on the first
          // committed move (in finalizeMove, before spiderPhase), so
          // the spider phase first sees a non-frozen value of 11.
          if ((state.turnsThisLevel || 0) <= 10) return;
          const speed = spider.isBaby ? BABY_SPEED : SPIDER_SPEED;
          for (let step = 0; step < speed; step++) {
            if (!spider.alive) return;
            // If the spider is already adjacent to IN, the next move is
            // an exit-through-IN: emit the slide-off FX anchored at IN
            // (not the spider's cell, so the animation always exits in
            // the IN-cell direction) and remove the spider.
            if (manhattan(spider, IN_CELL) === 1) {
              state.pendingFx.push({ type: 'spider-exit', c: IN_CELL.c, r: IN_CELL.r });
              spider.alive = false;
              return;
            }
            // Pick the closest IN-neighbor that's reachable and BFS to
            // it. bfsPath refuses IN itself as a destination, so we
            // aim one cell out.
            const neighbors = [
              { c: IN_CELL.c + 1, r: IN_CELL.r },
              { c: IN_CELL.c - 1, r: IN_CELL.r },
              { c: IN_CELL.c, r: IN_CELL.r + 1 },
              { c: IN_CELL.c, r: IN_CELL.r - 1 },
            ].filter((n) => inBounds(n.c, n.r) && !isInOrOut(n.c, n.r));
            let bestPath = null;
            for (const n of neighbors) {
              const path = bfsPath(spider, n);
              if (!path || !path.length) continue;
              if (!bestPath || path.length < bestPath.length) bestPath = path;
            }
            if (!bestPath) return; // boxed in — try again next phase
            spider.c = bestPath[0].c;
            spider.r = bestPath[0].r;
          }
          return;
        }
        // One-shot scripted move (used by level 0 to force love mode on the
        // first spider phase). null = stay put this phase. Otherwise teleport
        // to the target cell, resolve any player collisions, and exit before
        // the normal aggro/wander loop runs.
        if ('scriptedMove' in spider) {
          const target = spider.scriptedMove;
          delete spider.scriptedMove;
          if (!target) return;
          if (inBounds(target.c, target.r) &&
              state.env[target.r][target.c] !== 'boulder' &&
              !state.rocks[target.r][target.c]) {
            spider.c = target.c;
            spider.r = target.r;
            for (const p of state.players) {
              if (p.status !== 'on-grid') continue;
              if (p.c !== spider.c || p.r !== spider.r) continue;
              resolveCollision(p, spider);
              if (!spider.alive) return;
            }
          }
          return;
        }
        const speed = spider.isBaby ? BABY_SPEED : SPIDER_SPEED;
        for (let step = 0; step < speed; step++) {
          if (!spider.alive) return;
          // Build the list of players this spider is even allowed to consider.
          const eligible = state.players.filter((p) =>
            p.status === 'on-grid' &&
            !(p.invisibleTurnsLeft > 0) &&
            !isPlayerOnTree(p)
          );
          if (eligible.length === 0) return; // nothing visible → stay put

          // Look for the closest in-range eligible player (Manhattan distance).
          let target = null;
          let bestDist = Infinity;
          for (const p of eligible) {
            const d = manhattan(spider, p);
            if (d <= SPIDER_AGGRO_RANGE && d < bestDist) {
              bestDist = d;
              target = p;
            }
          }

          let nextCell = null;
          if (spider.firstMoveDir && step === 0) {
            // Pre-scripted opening direction (used by levels that want a
            // deterministic first move — e.g. nudging a spider onto a TnT
            // cell as a tutorial demo). Consumed regardless of legality:
            // an illegal direction just means the spider stays put for
            // this step. Bypasses chase/wander entirely.
            const fmd = spider.firstMoveDir;
            delete spider.firstMoveDir;
            const nc = spider.c + fmd.dc;
            const nr = spider.r + fmd.dr;
            if (inBounds(nc, nr) &&
                !isInOrOut(nc, nr) &&
                state.env[nr][nc] !== 'boulder' &&
                !state.rocks[nr][nc] &&
                !(state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr)) &&
                !isWallTraversalBlocked(spider.c, spider.r, fmd.dc, fmd.dr)) {
              nextCell = { c: nc, r: nr };
            }
          } else if (target) {
            // Chase: BFS one step toward the target.
            const path = bfsPath(spider, target);
            if (path && path.length
              && state.env[path[0].r][path[0].c] !== 'boulder'
              && !state.rocks[path[0].r][path[0].c]
              && !(state.locks[path[0].r] && state.locks[path[0].r][path[0].c] && !isLockHeldOpenByButton(path[0].c, path[0].r))) {
              nextCell = path[0];
            }
          } else {
            // Wander: pick a random in-bounds orthogonal neighbor that
            // is not a Boulder, IN cell, or OUT cell, and that is not
            // separated from the spider by a wall bar.
            const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
            shuffle(dirs);
            for (const [dc, dr] of dirs) {
              const nc = spider.c + dc;
              const nr = spider.r + dr;
              if (!inBounds(nc, nr)) continue;
              if (isInOrOut(nc, nr)) continue;
              if (state.env[nr][nc] === 'boulder') continue;
              if (state.rocks[nr][nc]) continue;
              if (state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr)) continue;
              if (isWallTraversalBlocked(spider.c, spider.r, dc, dr)) continue;
              nextCell = { c: nc, r: nr };
              break;
            }
          }
          if (!nextCell) return; // boxed in or no legal step

          spider.c = nextCell.c;
          spider.r = nextCell.r;

          // Apply on-arrival effects (TnT, lava, player collisions) at
          // the new cell. Factored into a helper so the river-carry
          // chain below can re-use the exact same logic at each step
          // of the chain — a spider drifting through a river-river-tnt
          // sequence should still explode on the TnT cell.
          if (resolveSpiderArrival(spider)) return;

          // River: if the spider stepped onto a river cell, the current
          // carries it through the river chain just like it carries a
          // player. The chain stops on a non-river cell, an edge, a
          // wall bar, another rock/spider, a locked cell (unless held
          // open), or an IN/OUT cell. Lava / TnT / player collisions at
          // any chain step halt the carry via resolveSpiderArrival's
          // return value.
          if (state.env[spider.r][spider.c] === 'river') {
            flowAlongRiver(
              spider,
              (nc, nr) =>
                state.rocks[nr][nc] ||
                state.env[nr][nc] === 'boulder' ||
                isInOrOut(nc, nr) ||
                (state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr)) ||
                state.spiders.some((s) => s.alive && s !== spider && s.c === nc && s.r === nr),
              (s) => resolveSpiderArrival(s)
            );
            if (!spider.alive) return;
          }
        }
      }

      // Apply the effects of a spider stepping onto its current cell:
      // explode on TnT (cell becomes neutral, spider dies, +10 score),
      // die on lava (cell stays a hazard, spider dies, +10 score), or
      // collide with any player standing on the cell. Returns true if
      // the spider died or was otherwise halted — callers should bail
      // out of further processing in that case.
      function resolveSpiderArrival(spider) {
        if (state.env[spider.r][spider.c] === 'tnt') {
          state.pendingFx.push({ type: 'boom', c: spider.c, r: spider.r });
          state.env[spider.r][spider.c] = 'neutral';
          spider.alive = false;
          addScore(10, `${wormify('Spider')} blew itself up`);
          return true;
        }
        if (state.env[spider.r][spider.c] === 'lava') {
          state.pendingFx.push({ type: 'lavakill', c: spider.c, r: spider.r });
          spider.alive = false;
          addScore(10, `${wormify('Spider')} fell into lava`);
          return true;
        }
        for (const p of state.players) {
          if (p.status !== 'on-grid') continue;
          if (p.c !== spider.c || p.r !== spider.r) continue;
          resolveCollision(p, spider);
          if (!spider.alive) return true;
        }
        return false;
      }

      function spiderPhase() {
        if (state.winner !== null) return;
        // Snapshot the list so spiders born this phase don't move on their birth turn.
        const movers = state.spiders.filter((s) => s.alive && !s.justBorn);
        for (const sp of movers) {
          if (!sp.alive) continue;
          stepSpider(sp);
          if (state.winner !== null) break;
        }
        // Tick down baby growth timers for any baby that participated this phase.
        // Newborns (justBorn) skip the tick this turn and become regular babies next turn.
        for (const sp of state.spiders) {
          if (!sp.alive) continue;
          if (sp.justBorn) {
            sp.justBorn = false;
            continue;
          }
          if (sp.isBaby) {
            sp.babyTurnsLeft -= 1;
            if (sp.babyTurnsLeft <= 0) {
              sp.isBaby = false;
              sp.babyTurnsLeft = 0;
            }
          }
        }
        // Love mode: any cell with ≥2 live ADULT spiders spawns one baby.
        // Babies (and dead spiders) don't count as parents. Disabled on
        // the petting-zoo bonus level — spiders are on a one-way march
        // to IN and shouldn't multiply on the way out.
        const cellMap = new Map();
        if (!isPettingZooLevel()) {
          for (const sp of state.spiders) {
            if (!sp.alive || sp.isBaby) continue;
            const key = `${sp.r},${sp.c}`;
            cellMap.set(key, (cellMap.get(key) || 0) + 1);
          }
        }
        for (const [key, count] of cellMap) {
          if (count < 2) continue;
          if (state.spiders.filter((s) => s.alive).length >= MAX_SPIDERS) break;
          const [r, c] = key.split(',').map(Number);
          state.pendingFx.push({ type: 'love', c, r });
          // Companion toast on the same cell so the player notices a
          // new baby has appeared (the heart alone is easy to miss).
          state.pendingFx.push({ type: 'baby', c, r });
          state.spiders.push({
            c, r,
            alive: true,
            isBaby: true,
            babyTurnsLeft: BABY_GROW_TURNS,
            justBorn: true,
          });
        }
        // Remove dead spiders entirely (TnT, knife, etc).
        state.spiders = state.spiders.filter((s) => s.alive);
      }

      // ── Movement ─────────────────────────────────────────────────────────
      // Shared helper: is the river flow at (c, r) currently usable as a
       // legal carry step? A river is usable when the cell it points to is
       // on-grid, not blocked by a wall, not occupied by a rock, not locked
       // (without a button holding it open), and not a deadly tile (lava /
       // TnT). Used by legalMoves to decide between "single forced move"
       // (flow usable) and "escape: any open cardinal direction" (flow
       // blocked), and by movePlayer to decide whether to hand off to
       // handleRiver or fall through to normal step / rock-push behavior.
       function isRiverFlowUsable(c, r) {
         if (!(state.env[r] && state.env[r][c] === 'river')) return false;
         const flow = state.riverDirs[r] && state.riverDirs[r][c];
         if (!flow) return false;
         const nc = c + flow.dc, nr = r + flow.dr;
         if (!inBounds(nc, nr)) return false;
         if (isWallTraversalBlocked(c, r, flow.dc, flow.dr)) return false;
         if (state.rocks[nr] && state.rocks[nr][nc]) return false;
         if (state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr)) return false;
         // Note: lava and TnT are NOT escape conditions. A river flowing
         // into lava or TnT carries the player to their death — the
         // current is a hazard, not a safety rail. handleRiver +
         // ENV_TYPES.onEnter handle the kill.
         return true;
       }

      function legalMoves(playerIdx) {
        if (state.winner !== null) return [];
        const p = state.players[playerIdx];
        if (p.status === 'exited') return [];
        if (p.status === 'off-grid') {
          return [{ c: IN_CELL.c, r: IN_CELL.r }];
        }
        // If the player is on a portal cell, the bar direction is replaced
        // with a teleport to the partner portal cell instead of stepping
        // into the adjacent cell. Other cardinal directions follow normal
        // step rules.
        const onPortal = isPortalKey(state.env[p.r][p.c]);
        const portalBar = onPortal ? state.portalDirs[p.r][p.c] : null;
        const partner = (onPortal && portalBar) ? getPartnerPortal(p.c, p.r) : null;

        const moves = [];
        const deltas = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        // A player who STARTS on a river cell normally has exactly ONE legal
        // move: the cell that the river's flow direction points to (and only
        // if that cell is reachable — not off-grid, blocked by wall, rock,
        // lock, lava, or TnT). Rivers don't slide through other obstacles.
        //
        // Fallback rule: if the flow direction is unusable, the player
        // would otherwise be trapped — either physically (wall, rock,
        // locked cell, edge of grid) or by being force-marched into a
        // deadly tile (lava, TnT). In either case we let them step off
        // in ANY open cardinal direction. Rock pushing IS allowed in
        // this escape mode (so a rock that the river carried into a
        // dead end can still be pushed onward, e.g. through a portal).
        // Locked cells still require a key.
        const startedOnRiver = state.env[p.r] && state.env[p.r][p.c] === 'river';
        if (startedOnRiver) {
          if (isRiverFlowUsable(p.c, p.r)) {
            const flow = state.riverDirs[p.r][p.c];
            return [{ c: p.c + flow.dc, r: p.r + flow.dr }];
          }
          // Flow is unusable → escape hatch: any open cardinal step works,
          // including a rock push.
          for (const [dc, dr] of deltas) {
            const nc = p.c + dc, nr = p.r + dr;
            if (!inBounds(nc, nr)) continue;
            if (isWallTraversalBlocked(p.c, p.r, dc, dr)) continue;
            // Locked cells still require a key (or a held-open button).
            if (state.locks[nr] && state.locks[nr][nc] &&
                !isLockHeldOpenByButton(nc, nr) && (p.keys || 0) <= 0) continue;
            // Rock push: allowed in escape mode so the player can shove
            // a river-stuck rock onward (e.g. into a portal). The push
            // still has to satisfy canPushRock (cell behind the rock is
            // safe / not blocked).
            if (state.rocks[nr] && state.rocks[nr][nc]) {
              if (!canPushRock(nc, nr, dc, dr)) continue;
            }
            moves.push({ c: nc, r: nr });
          }
          return moves;
        }
        // A player who STARTS on a slide cell will slide instead of taking a
        // single step — they cannot push rocks. A move toward a rock from a
        // slide cell is therefore illegal (it would just stop the slide on
        // the current cell, wasting the turn).
        const startedOnSlide = state.env[p.r] && state.env[p.r][p.c] === 'slide';
        for (const [dc, dr] of deltas) {
          // Bar direction on a portal: teleport to partner instead of stepping.
          if (portalBar && partner && dc === portalBar.dc && dr === portalBar.dr) {
            // If the partner cell already has a rock resting on it, the
            // teleport is only legal if the player can BUMP that rock
            // off the partner in the partner's emerge direction
            // (opposite the partner's bar). If the rock can't be
            // bumped (edge, wall, another rock, locked cell, etc.) the
            // teleport is refused — the player has nowhere safe to
            // land.
            if (state.rocks[partner.r] && state.rocks[partner.r][partner.c]) {
              const partnerBar = state.portalDirs[partner.r] && state.portalDirs[partner.r][partner.c];
              if (!partnerBar) continue;
              const emergeDc = -partnerBar.dc, emergeDr = -partnerBar.dr;
              if (!canPushRock(partner.c, partner.r, emergeDc, emergeDr)) continue;
            }
            moves.push({ c: partner.c, r: partner.r });
            continue;
          }
          const nc = p.c + dc, nr = p.r + dr;
          if (!inBounds(nc, nr)) continue;
          // Walls block traversal across their flagged edges in BOTH directions:
          // departing from the player's cell, or entering the target cell from
          // its opposite-side wall edge.
          if (isWallTraversalBlocked(p.c, p.r, dc, dr)) continue;
          // Locked cell: entry is blocked unless the player is carrying a
          // key. A Button holding the lock open lets the player pass
          // without a key (and without consuming one at commit time).
          if (state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr) && (p.keys || 0) <= 0) continue;
          // Rock push: stepping into a rock is only legal if the rock can be
          // displaced one cell further in the same direction. Slide-start
          // moves cannot push rocks at all.
          if (state.rocks[nr][nc]) {
            if (startedOnSlide) continue;
            if (!canPushRock(nc, nr, dc, dr)) continue;
          }
          moves.push({ c: nc, r: nr });
        }
        return moves;
      }

      // Returns true if a wall on either the source cell (blocking direction
      // (dc, dr)) or the destination cell (blocking the opposite direction)
      // forbids traversal across that edge. Boulders count as walls with all
      // four sides blocked, so any traversal touching a boulder cell
      // (entering or leaving) is refused.
      function isWallTraversalBlocked(fromC, fromR, dc, dr) {
        // Boulder source: every cardinal departure is blocked.
        if (state.env[fromR] && state.env[fromR][fromC] === 'boulder') return true;
        const fromWalls = state.wallDirs[fromR] && state.wallDirs[fromR][fromC];
        if (fromWalls && fromWalls.some((w) => w.dc === dc && w.dr === dr)) return true;
        const toC = fromC + dc, toR = fromR + dr;
        if (toR < 0 || toR >= ROWS || toC < 0 || toC >= COLS) return false;
        // Boulder destination: every cardinal entry is blocked.
        if (state.env[toR] && state.env[toR][toC] === 'boulder') return true;
        const toWalls = state.wallDirs[toR] && state.wallDirs[toR][toC];
        if (toWalls && toWalls.some((w) => w.dc === -dc && w.dr === -dr)) return true;
        return false;
      }

      // Returns true if a rock at (rc, rr) can be pushed in direction (dc, dr).
      // Strict push semantics: the cell behind the rock must exist, must not
      // be an IN or OUT gate, must not be a boulder or another rock, and the
      // wall/boulder traversal from the rock's cell to the destination must
      // not be blocked. Note: this does NOT check the cell underneath the
      // rock for walls departing toward (dc, dr) on the rock cell itself —
      // walls on the rock cell are uncommon and would over-restrict pushes.
      function canPushRock(rc, rr, dc, dr) {
        // Source-portal exit: the rock is currently resting on a portal
        // and is being shoved in the same direction as that portal's
        // bar. The rock will teleport to the partner portal cell
        // (NOT step into rc+dc, rr+dr) — so the destination-safety
        // checks are against the PARTNER cell, not the adjacent one.
        const srcEnv = state.env[rr] && state.env[rr][rc];
        if (isPortalKey(srcEnv)) {
          const srcBar = state.portalDirs[rr] && state.portalDirs[rr][rc];
          if (srcBar && srcBar.dc === dc && srcBar.dr === dr) {
            const partner = getPartnerPortal(rc, rr);
            const partnerBar = partner && state.portalDirs[partner.r][partner.c];
            // Unpaired portal: nowhere to go — refuse.
            if (!partner || !partnerBar) return false;
            if (isInOrOut(partner.c, partner.r)) return false;
            if (state.rocks[partner.r][partner.c]) return false;
            if (state.locks[partner.r] && state.locks[partner.r][partner.c] &&
                !isLockHeldOpenByButton(partner.c, partner.r)) return false;
            const pEnv = state.env[partner.r] && state.env[partner.r][partner.c];
            if (pEnv === 'tree' || pEnv === 'boulder') return false;
            return true;
          }
        }
        const tc = rc + dc, tr = rr + dr;
        if (!inBounds(tc, tr)) return false;
        if (isInOrOut(tc, tr)) return false;
        // Reuse the shared traversal check: this catches boulder destinations
        // and any wall bars on either side of the edge.
        if (isWallTraversalBlocked(rc, rr, dc, dr)) return false;
        // Cannot push a rock onto another rock (no chain pushing in v1).
        if (state.rocks[tr][tc]) return false;
        // Cannot push a rock into a locked cell — nothing enters a lock,
        // unless a Button is currently holding that lock open (in which
        // case the rock can be pushed onto it).
        if (state.locks[tr] && state.locks[tr][tc] && !isLockHeldOpenByButton(tc, tr)) return false;
        // Cannot push a rock into a Tree — the canopy is treated as a
        // soft barrier for shoves (players and spiders still pass
        // through trees freely, but pushed rocks stop short).
        if (state.env[tr] && state.env[tr][tc] === 'tree') return false;
        // Portal-through push: if the target is a portal AND the push
        // direction matches the portal's bar direction, the rock will
        // teleport to the partner portal cell (mirrors the player/slide
        // exit-via-bar rule). When a partner exists, the partner cell
        // must be safe for a rock to land on — otherwise the push is
        // refused. When NO partner exists (or the partner is missing a
        // bar), the rock just rests on the portal cell, same as a
        // slide stopping on an unpaired portal — push is allowed.
        if (isPortalKey(state.env[tr] && state.env[tr][tc])) {
          const portalBar = state.portalDirs[tr] && state.portalDirs[tr][tc];
          const exitMatchesBar =
            portalBar && portalBar.dc === dc && portalBar.dr === dr;
          if (exitMatchesBar) {
            const partner = getPartnerPortal(tc, tr);
            const partnerBar = partner && state.portalDirs[partner.r][partner.c];
            if (partner && partnerBar) {
              if (isInOrOut(partner.c, partner.r)) return false;
              if (state.rocks[partner.r][partner.c]) return false;
              if (state.locks[partner.r] && state.locks[partner.r][partner.c] &&
                  !isLockHeldOpenByButton(partner.c, partner.r)) return false;
              const pEnv = state.env[partner.r] && state.env[partner.r][partner.c];
              if (pEnv === 'tree' || pEnv === 'boulder') return false;
            }
          }
        }
        return true;
      }

      // Called after a pushed rock arrives at (tc, tr). Handles environment
      // interactions for the new cell:
      //   • Lava: rock destroys itself filling the lava — cell becomes a
      //     permanent boulder. Players can no longer cross it.
      //   • TnT: rock detonates the bomb. Both the rock and the TnT are
      //     consumed; the cell reverts to neutral. The active player earns
      //     +10 for triggering it without dying.
      //   • River: the rock is carried by the current through the river
      //     chain (mirrors the player + spider river behavior). The chain
      //     ends on the first non-river cell, an edge, a wall bar, an
      //     existing rock, a tree, a closed lock, or any boulder. If the
      //     chain ends on lava the rock turns the cell into a boulder; if
      //     it ends on TnT the rock detonates it.
      //   • Portal: if the rock's push direction matches the portal's
      //     bar direction (i.e. it would exit through the bar), the rock
      //     teleports to the partner portal cell — mirroring the
      //     player/slide exit-via-bar rule. The rock comes to rest on
      //     the partner cell; it does NOT continue moving in the
      //     partner's emerge direction. If the bar doesn't match the
      //     push direction (or there's no partner), the rock just rests
      //     on the portal cell. canPushRock has already verified that
      //     the partner cell is safe.
      //   • Anything else (slide, knight, neutral): no special chaining
      //     — the rock just rests on the cell. Slide chains intentionally
      //     don't fire for rocks.
      function resolveRockArrival(tc, tr, dir) {
        // A rock that arrives on (or is carried through) a spider's
        // cell crushes the spider. Mirrors the lava/tnt environmental
        // tier (+10 score, zap flash).
        killSpidersOnCell(tc, tr);
        const env = state.env[tr] && state.env[tr][tc];
        if (env === 'lava') {
          state.pendingFx.push({ type: 'sizzle', c: tc, r: tr });
          state.rocks[tr][tc] = false;
          state.env[tr][tc] = 'boulder';
          return;
        }
        if (env === 'tnt') {
          state.pendingFx.push({ type: 'boom', c: tc, r: tr });
          state.rocks[tr][tc] = false;
          state.env[tr][tc] = 'neutral';
          addScore(10, 'Detonated TnT with a rock');
          return;
        }
        if (env === 'river') {
          // Track the rock's current resting cell as a free-floating
          // position object; flowAlongRiver mutates it in place. The
          // rock slot in state.rocks is cleared up-front and re-set at
          // the chain's final resting cell so passers-through (rocks,
          // spiders, etc.) see a consistent state during the carry.
          state.rocks[tr][tc] = false;
          const rockPos = { c: tc, r: tr };
          let consumed = false;
          flowAlongRiver(
            rockPos,
            // Rocks cannot drift into another rock, a closed lock, a
            // tree (canopy is a soft barrier for shoves and shoves-by-
            // current), or a boulder.
            (nc, nr) =>
              state.rocks[nr][nc] ||
              state.env[nr][nc] === 'boulder' ||
              state.env[nr][nc] === 'tree' ||
              (state.locks[nr] && state.locks[nr][nc] && !isLockHeldOpenByButton(nc, nr)),
            (e) => {
              // Crush any spider on the cell the river just carried
              // the rock through. Spiders are not flow-blockers; they
              // simply die under the passing rock.
              killSpidersOnCell(e.c, e.r);
              const cellEnv = state.env[e.r][e.c];
              if (cellEnv === 'lava') {
                state.pendingFx.push({ type: 'sizzle', c: e.c, r: e.r });
                state.env[e.r][e.c] = 'boulder';
                consumed = true;
                return true;
              }
              if (cellEnv === 'tnt') {
                state.pendingFx.push({ type: 'boom', c: e.c, r: e.r });
                state.env[e.r][e.c] = 'neutral';
                addScore(10, 'Detonated TnT with a rock');
                consumed = true;
                return true;
              }
              return false;
            }
          );
          if (consumed) return;
          // River chain settled on a non-river cell. The rock just rests
          // there — even if that cell is a portal. The player can choose
          // to push the rock through the portal on a later turn (which
          // re-enters resolveRockArrival via the regular push path and
          // hits the portal teleport branch below).
          state.rocks[rockPos.r][rockPos.c] = true;
          return;
        }
        if (isPortalKey(env)) {
          // Exit-via-bar: push direction must match the portal's bar
          // for the rock to teleport. Otherwise the rock just rests on
          // the portal cell (same as a slide passing through a portal
          // whose bar doesn't match its slide direction).
          const portalBar = state.portalDirs[tr] && state.portalDirs[tr][tc];
          const exitMatchesBar =
            portalBar && portalBar.dc === dir.dc && portalBar.dr === dir.dr;
          if (!exitMatchesBar) return;
          const partner = getPartnerPortal(tc, tr);
          const partnerBar = partner && state.portalDirs[partner.r][partner.c];
          // Unpaired portal → rock rests on the entry portal (mirrors
          // the slide "no partner" fallback).
          if (!partner || !partnerBar) return;
          // Defensive re-check of partner-cell safety. canPushRock
          // already validated this at move-commit, but a future caller
          // (e.g. a future river-into-portal chain) could call us
          // without that gate.
          if (isInOrOut(partner.c, partner.r)) return;
          if (state.rocks[partner.r][partner.c]) return;
          if (state.locks[partner.r] && state.locks[partner.r][partner.c] &&
              !isLockHeldOpenByButton(partner.c, partner.r)) return;
          const pEnv = state.env[partner.r] && state.env[partner.r][partner.c];
          if (pEnv === 'tree' || pEnv === 'boulder') return;
          // Teleport: rock leaves the entry portal and lands on the
          // partner portal cell. Crush any spider on the partner cell.
          killSpidersOnCell(partner.c, partner.r);
          state.rocks[tr][tc] = false;
          state.rocks[partner.r][partner.c] = true;
          return;
        }
      }

      // ── Lock / Unlock public API ─────────────────────────────────────────
      // Locks are a layer that sits on top of the cell's env / item / OUT
      // marker without modifying any of them. While a cell is locked, no
      // entity (player, spider, or rock) may enter it. A player carrying
      // at least one key can unlock the cell at move-commit time, which
      // consumes one key from their stack and lets the move resolve as if
      // the lock had never been there.
      //
      // Triggers for these calls are intentionally left open — they are
      // safe to invoke from anywhere (level init, env handlers, score
      // events, future scripted puzzles, the browser console for testing,
      // etc.). The call itself is a no-op if the cell is already in the
      // requested state.
      function lockCell(c, r) {
        if (!inBounds(c, r)) return false;
        if (state.locks[r][c]) return false;
        state.locks[r][c] = true;
        state.pendingFx.push({ type: 'lock-descend', c, r });
        if (typeof render === 'function') render();
        return true;
      }
      function unlockCell(c, r) {
        if (!inBounds(c, r)) return false;
        if (!state.locks[r][c]) return false;
        state.locks[r][c] = false;
        state.pendingFx.push({ type: 'lock-ascend', c, r });
        if (typeof render === 'function') render();
        return true;
      }
      // Expose to the browser console so triggers can be wired up later.
      window.lockCell = lockCell;
      window.unlockCell = unlockCell;

      function onCellClick(c, r) {
        if (state.editMode) {
          onEditClick(c, r);
          return;
        }
        if (state.winner !== null) return;
        if (state.levelCleared) return; // game paused while the Level Cleared modal is up
        if (state.animating) return; // ignore clicks while a traverse animation is playing
        const idx = state.currentPlayer;
        const moves = legalMoves(idx);
        if (moves.length === 0) return;
        const p = state.players[idx];

        // Off-grid: any click enters via IN (only legal move available).
        if (p.status === 'off-grid') {
          const m = moves[0];
          movePlayer(idx, m.c, m.r);
          return;
        }

        // Clicked own cell: normally ignored, BUT if the player is standing
        // on a portal cell whose bar points off-grid (i.e. the bar sits on
        // the edge of the board), there is no neighbor cell to click in the
        // bar direction. In that case, treat a click on the portal's own
        // cell (which includes clicks on the rendered dashed bar) as
        // "exit-via-bar" — teleport to the partner portal.
        if (c === p.c && r === p.r) {
          if (isPortalKey(state.env[p.r][p.c])) {
            const pd = state.portalDirs[p.r][p.c];
            const partner = pd ? getPartnerPortal(p.c, p.r) : null;
            const barOffGrid = pd && !inBounds(p.c + pd.dc, p.r + pd.dr);
            if (barOffGrid && partner) {
              const m = moves.find((mv) => mv.c === partner.c && mv.r === partner.r);
              if (m) {
                movePlayer(idx, m.c, m.r);
                return;
              }
            }
          }
          return;
        }

        // If the user clicked exactly on a legal neighbor, use that.
        const exact = moves.find((m) => m.c === c && m.r === r);
        if (exact) {
          movePlayer(idx, exact.c, exact.r);
          return;
        }

        // Otherwise interpret the click as a direction. Pick the dominant axis
        // (horizontal vs vertical) of the click delta, with horizontal as tiebreak.
        const dc = c - p.c;
        const dr = r - p.r;
        const candidates = [];
        if (Math.abs(dc) >= Math.abs(dr)) {
          if (dc !== 0) candidates.push({ dc: Math.sign(dc), dr: 0 });
          if (dr !== 0) candidates.push({ dc: 0, dr: Math.sign(dr) });
        } else {
          if (dr !== 0) candidates.push({ dc: 0, dr: Math.sign(dr) });
          if (dc !== 0) candidates.push({ dc: Math.sign(dc), dr: 0 });
        }
        for (const d of candidates) {
          const tc = p.c + d.dc;
          const tr = p.r + d.dr;
          let m = moves.find((mv) => mv.c === tc && mv.r === tr);
          // Portal exit fallback: if standing on a portal whose bar matches
          // the resolved direction, the matching legal move is the partner
          // cell (legalMoves replaces the adjacent step with a teleport).
          if (!m && isPortalKey(state.env[p.r][p.c])) {
            const pd = state.portalDirs[p.r][p.c];
            if (pd && pd.dc === d.dc && pd.dr === d.dr) {
              const partner = getPartnerPortal(p.c, p.r);
              if (partner) m = moves.find((mv) => mv.c === partner.c && mv.r === partner.r);
            }
          }
          if (m) {
            movePlayer(idx, m.c, m.r);
            return;
          }
        }
      }

      function movePlayer(idx, c, r) {
        const p = state.players[idx];
        // Direction the player was moving when entering the new cell.
        let dir = { dc: 0, dr: 0 };
        if (p.status === 'on-grid') {
          dir = { dc: c - p.c, dr: r - p.r };
        }
        // Arm Undo: snapshot every mutable layer right before we commit
        // the move. The Undo button consumes this snapshot once, then
        // disables itself until the next successful move re-arms it.
        takeUndoSnapshot();

        // Reset traverse path. Each TRAVERSE step (single-step move, slide)
        // pushes a {c, r} entry. JUMP steps (knight, portal teleport) push a
        // {c, r, jump: true} entry which the animator uses to break the smooth
        // transition and reseat the token at the new position instantly.
        state.pendingPath = null;
        const startedOnGrid = p.status === 'on-grid';
        const startCell = startedOnGrid ? { c: p.c, r: p.r } : null;

        // Portal exit (JUMP move) — detected EARLY, before the rock-push
        // block below, because the click target on a portal teleport is
        // the (non-adjacent) partner cell, not a normal step neighbor.
        // The rock-push block would otherwise misinterpret a rock on the
        // partner cell as something to shove using the (meaningless) A→B
        // vector. If the partner cell already has a rock on it, bump
        // the rock off the partner in the emerge direction (opposite
        // the partner's bar) and then place the player on the partner.
        // legalMoves has already validated the bump destination via
        // canPushRock.
        if (startedOnGrid && isPortalKey(state.env[p.r][p.c])) {
          const partner = getPartnerPortal(p.c, p.r);
          if (partner && partner.c === c && partner.r === r) {
            const partnerBar = state.portalDirs[partner.r][partner.c];
            // Bump a rock resting on the partner cell out through the
            // emerge side before the player lands on it.
            if (partnerBar && state.rocks[partner.r] && state.rocks[partner.r][partner.c]) {
              const emergeDir = { dc: -partnerBar.dc, dr: -partnerBar.dr };
              const ec = partner.c + emergeDir.dc, er = partner.r + emergeDir.dr;
              if (inBounds(ec, er)) {
                state.rocks[partner.r][partner.c] = false;
                state.rocks[er][ec] = true;
                resolveRockArrival(ec, er, emergeDir);
              }
            }
            p.c = partner.c; p.r = partner.r;
            if (partnerBar) {
              p.lastDir = { dc: -partnerBar.dc, dr: -partnerBar.dr };
            }
            state.pendingPath = [startCell, { c: p.c, r: p.r, jump: true }];
            animateThenFinalize(idx);
            return;
          }
        }

        // Rock push: if the target cell is a rock and this is a normal step
        // move (not a slide-start — slides can't push rocks), displace the
        // rock one cell in the same direction. legalMoves already verified
        // that the destination is valid via canPushRock(). The push is
        // non-destructive: rocks live in state.rocks[r][c], distinct from
        // state.env[r][c], so the underlying env on either cell is preserved.
        // After the rock arrives at its new cell, resolveRockArrival() may
        // trigger rich interactions (slide chain, portal teleport, TnT
        // explosion) on that cell.
        const startedOnSlide =
          startedOnGrid &&
          state.env[p.r] && state.env[p.r][p.c] === 'slide' &&
          (dir.dc !== 0 || dir.dr !== 0);
        // River-start is only "true" for movement-rule purposes when the
        // river is actually going to carry the player this turn. If the
        // flow is blocked (wall/rock/lock/edge/lava/tnt downstream),
        // legalMoves switched us to escape mode and we should behave like
        // a normal step instead — including being allowed to push rocks.
        const startedOnRiver =
          startedOnGrid &&
          state.env[p.r] && state.env[p.r][p.c] === 'river' &&
          isRiverFlowUsable(p.c, p.r);
        if (startedOnGrid && !startedOnSlide && !startedOnRiver &&
            state.rocks[r] && state.rocks[r][c] &&
            (dir.dc !== 0 || dir.dr !== 0)) {
          // Source-portal exit: rock is on a portal and being shoved
          // through the bar. Teleport to the partner cell instead of
          // stepping forward. canPushRock has already validated that
          // the partner cell is safe.
          const srcEnv = state.env[r][c];
          const srcBar = isPortalKey(srcEnv) ? state.portalDirs[r][c] : null;
          if (srcBar && srcBar.dc === dir.dc && srcBar.dr === dir.dr) {
            const partner = getPartnerPortal(c, r);
            if (partner) {
              state.rocks[r][c] = false;
              // Crush any spider on the partner cell as the rock
              // teleports onto it.
              killSpidersOnCell(partner.c, partner.r);
              state.rocks[partner.r][partner.c] = true;
            }
          } else {
            const tc = c + dir.dc, tr = r + dir.dr;
            if (inBounds(tc, tr)) {
              state.rocks[r][c] = false;
              state.rocks[tr][tc] = true;
              resolveRockArrival(tc, tr, dir);
            }
          }
        }

        // Portal exit (JUMP move): the player is on a portal cell and clicked
        // the partner cell (or the bar direction). Teleport — do NOT trigger
        // any onEnter at the destination, and face the player AWAY from the
        // partner's bar so they emerge pointing outward.
        // (Handled earlier in movePlayer — see the early portal-jump branch
        // above the rock-push block. This trailing comment is kept as a
        // signpost in case future control flow lands here.)

        // Special case: if the player STARTED their turn on a slide cell, the
        // click picks the slide direction. Slide from the current cell instead
        // of taking a normal 1-step move. (Walls are still respected: legalMoves
        // already screened the chosen direction, and handleSlide re-checks each
        // step it takes.)
        // Note: startedOnSlide was already computed above for the rock-push
        // pre-check. Reuse it here.
        if (startedOnSlide) {
          p.lastDir = dir;
          handleSlide(p, dir);
        } else if (startedOnRiver) {
          // River-start: the player's click necessarily matches the flow
          // direction (legalMoves only offered that one destination). Hand
          // off to handleRiver, which will read each river cell's own
          // direction and chain through the current.
          p.lastDir = dir;
          handleRiver(p, dir);
        } else {
          // Normal 1-step move (or off-grid → IN entry). The walk itself is a
          // traverse of one edge — record the origin and destination so the
          // animator can slide the token across.
          if (startedOnGrid) {
            state.pendingPath = [startCell, { c, r }];
          }
          // Locked destination: legalMoves only allowed this move if the
          // player has a key in hand OR a Button is currently holding the
          // lock open. The button case is free — pass through without
          // consuming a key and without permanently unlocking the cell
          // (the lock returns the moment the button releases).
          if (state.locks[r] && state.locks[r][c] && !isLockHeldOpenByButton(c, r)) {
            p.keys = Math.max(0, (p.keys || 0) - 1);
            unlockCell(c, r);
            addScore(50, 'Used a Key');
          }
          p.c = c; p.r = r;
          if (p.status === 'off-grid') p.status = 'on-grid';
          if (dir.dc !== 0 || dir.dr !== 0) p.lastDir = dir;

          // Run env effect on the cell we just stepped onto. Knight and Portal
          // are JUMP effects — they may relocate the player to a non-adjacent
          // cell. The relocation is recorded as a {jump:true} entry below.
          if (!isOutCell(c, r)) {
            const beforeC = p.c, beforeR = p.r;
            applyEffectOnCurrentCell(p, dir);
            if (p.status === 'on-grid' && (p.c !== beforeC || p.r !== beforeR)) {
              if (!state.pendingPath) state.pendingPath = [{ c: beforeC, r: beforeR }];
              state.pendingPath.push({ c: p.c, r: p.r, jump: true });
            }
          }
        }

        // Hand off to the animator. If there's nothing meaningful to animate
        // (no path, or the path is a single jump segment), finalizeMove runs
        // synchronously. Otherwise it runs after the animation completes.
        animateThenFinalize(idx);
      }

      // Play the queued traverse animation (if any), then run finalizeMove.
      // pendingPath is a list of cells in visit order. Consecutive entries are
      // smooth transitions; an entry with jump:true means “instantly reseat to
      // this cell” (used for knight + portal teleport). A path with fewer than
      // two TRAVERSE cells short-circuits straight to finalize — jumps look
      // instantaneous by spec.
      function animateThenFinalize(idx) {
        const path = state.pendingPath;
        // Determine if any animation is needed: at least two cells, with at
        // least one smooth (non-jump) transition between consecutive cells.
        let hasTraverse = false;
        if (Array.isArray(path) && path.length >= 2) {
          for (let i = 1; i < path.length; i++) {
            if (!path[i].jump) { hasTraverse = true; break; }
          }
        }
        if (!hasTraverse) {
          state.pendingPath = null;
          finalizeMove(idx);
          return;
        }
        state.animating = true;
        // Re-render once so the underlying board (env / weapons / spiders /
        // OTHER players) is current; we'll overlay an animated token on top
        // and skip rendering THIS player until the animation finishes.
        render({ hideActiveIdx: idx });
        spawnAnimatedToken(idx, path[0]);
        let i = 1;
        const stepDelay = 140; // matches CSS transition
        const stepTo = (cell) => {
          if (cell.jump) {
            placeAnimatedToken(cell, true); // no transition for jumps
          } else {
            placeAnimatedToken(cell, false);
          }
        };
        const tick = () => {
          if (i >= path.length) {
            removeAnimatedToken();
            state.animating = false;
            state.pendingPath = null;
            finalizeMove(idx);
            return;
          }
          stepTo(path[i]);
          i += 1;
          setTimeout(tick, stepDelay);
        };
        // Kick off after a short tick so the initial position settles.
        setTimeout(tick, 20);
      }

      // ── Animated traverse token (overlay) ──────────────────────────────
      // The animator paints a single floating div positioned over the board
      // and slides it from cell to cell using CSS left/top transitions. The
      // underlying token for the active player is suppressed during animation
      // (render's hideActiveIdx) so we don't see two tokens at the final cell.
      function spawnAnimatedToken(idx, startCell) {
        removeAnimatedToken();
        const p = state.players[idx];
        const cell = cellEls[startCell.r] && cellEls[startCell.r][startCell.c];
        if (!cell) return;
        const tok = document.createElement('div');
        tok.id = 'anim-token';
        tok.className = `p${idx + 1}`;
        if ((p.weapons || 0) > 0) {
          tok.innerHTML = '<span class="knife-icon">🗡</span>';
        } else {
          const label = (p.name || `P${idx + 1}`).slice(0, 3);
          tok.textContent = label;
        }
        // Match the visual size of a regular .token (~60% of a cell).
        const size = cell.offsetWidth * 0.6;
        tok.style.width = size + 'px';
        tok.style.height = size + 'px';
        tok.style.fontSize = Math.round(size * 0.34) + 'px';
        // Place without a transition for the initial spawn.
        tok.style.transition = 'none';
        positionAnimToken(tok, cell);
        boardEl.appendChild(tok);
        // Force reflow, then restore the CSS transition for subsequent moves.
        // eslint-disable-next-line no-unused-expressions
        void tok.offsetWidth;
        tok.style.transition = '';
      }

      function placeAnimatedToken(cell, instant) {
        const tok = document.getElementById('anim-token');
        if (!tok) return;
        const target = cellEls[cell.r] && cellEls[cell.r][cell.c];
        if (!target) return;
        if (instant) {
          // Jump segment: snap without a transition so the smooth motion
          // breaks visibly at the portal/knight teleport boundary.
          tok.style.transition = 'none';
          positionAnimToken(tok, target);
          void tok.offsetWidth;
          tok.style.transition = '';
        } else {
          positionAnimToken(tok, target);
        }
      }

      function positionAnimToken(tok, cellEl) {
        const w = parseFloat(tok.style.width) || cellEl.offsetWidth * 0.6;
        const h = parseFloat(tok.style.height) || cellEl.offsetHeight * 0.6;
        const left = cellEl.offsetLeft + (cellEl.offsetWidth - w) / 2;
        const top  = cellEl.offsetTop  + (cellEl.offsetHeight - h) / 2;
        tok.style.left = left + 'px';
        tok.style.top  = top + 'px';
      }

      function removeAnimatedToken() {
        const tok = document.getElementById('anim-token');
        if (tok) tok.remove();
      }

      // Run all the post-movement bookkeeping (pickups, spider phase, exit
      // check, turn advance, render). Split out of movePlayer so the animator
      // can defer it until the animation completes.
      function finalizeMove(idx) {
        const p = state.players[idx];
        // Count this commit as a turn played on the current level.
        // Resets to 0 on init() (i.e. on level start, level reset, or game reset).
        state.turnsThisLevel += 1;
        // Button phase: now that the player + any pushed rocks are in their
        // post-move positions, recompute which buttons are pressed and fire
        // any edge-triggered effects (TnT detonations on OFF→ON). This runs
        // BEFORE pickups / spider phase so a button-triggered explosion can
        // kill the player on the SAME turn they pressed it, just like a
        // direct TnT step would.
        processButtonPresses();
        // Pick up weapon at the player's final resting cell.
        // Weapons stack: each chest adds one knife to the player's stack.
        if (p.status === 'on-grid' && state.weapons[p.r][p.c]) {
          state.weapons[p.r][p.c] = false;
          p.weapons = (p.weapons || 0) + 1;
          state.pendingFx.push({ type: 'pickup', c: p.c, r: p.r });
          // Mark Spider Knife discovered the first time any player opens one.
          if (state.discovered.knife === null) state.discovered.knife = state.level;
          addScore(20, `Picked up ${wormify('Spider Knife')}`);
        }
        // Pick up an Invisibility Potion at the player's final resting cell.
        // Visually identical to a weapon chest on the board — only the pickup
        // toast tells the player which they got. Potions are now stored in
        // the player's inventory (p.potions) and only consumed when the
        // player explicitly clicks Drink Potion (or presses the P key);
        // see drinkPotion(). The pickup itself never starts the timer.
        if (p.status === 'on-grid' && state.potions[p.r][p.c]) {
          state.potions[p.r][p.c] = false;
          p.potions = (p.potions || 0) + 1;
          state.pendingFx.push({ type: 'potion-stored', c: p.c, r: p.r });
          // Mark Spider Freeze Potion discovered the first time any player opens one.
          if (state.discovered.potion === null) state.discovered.potion = state.level;
          addScore(20, 'Picked up Spider Freeze Potion');
        }
        // Pick up a Cake at the player's final resting cell. Cakes are
        // pure score — +100 each, no carry-over, no other effects.
        if (p.status === 'on-grid' && state.cakes[p.r] && state.cakes[p.r][p.c]) {
          state.cakes[p.r][p.c] = false;
          state.pendingFx.push({ type: 'cake', c: p.c, r: p.r });
          addScore(100, 'Picked up Cake');
        }
        // Pick up a Key at the player's final resting cell. Keys stack and
        // are consumed one-per-unlock in movePlayer when the player walks
        // onto a locked cell.
        if (p.status === 'on-grid' && state.keys[p.r] && state.keys[p.r][p.c]) {
          state.keys[p.r][p.c] = false;
          p.keys = (p.keys || 0) + 1;
          state.pendingFx.push({ type: 'key', c: p.c, r: p.r });
          addScore(20, 'Picked up Key');
        }

        // Player→spider collision at the final resting cell.
        if (p.status === 'on-grid') resolveSpidersOnPlayer(p);
        // Drop any spiders the player just killed with a knife from the game.
        state.spiders = state.spiders.filter((s) => s.alive);

        // Exit check (after effects: slide / knight may have moved player onto OUT).
        // Reaching OUT advances everyone to the next level. On the final level,
        // the game ends instead. The petting-zoo bonus (level 14) and the
        // sandbox slot (level 13) both count as "final" for game-over
        // purposes — sandbox preserves the original MAX_LEVEL-1 behavior
        // even though MAX_LEVEL now bumps past it, and petting-zoo follows
        // the same rule via the >= MAX_LEVEL - 1 check.
        if (p.status === 'on-grid' && isOutCell(p.c, p.r)) {
          p.status = 'exited';
          const isFinalLevel = state.level >= MAX_LEVEL - 1
                            || state.level === SANDBOX_LEVEL_INDEX
                            || state.level === PETTING_ZOO_LEVEL_INDEX;
          if (isFinalLevel) {
            // Final level cleared: declare the player who exited as the winner
            // and stop the game.
            if (state.winner === null) state.winner = idx;
          } else {
            // Pause the game and show the Level Cleared modal. The Next Level
            // button (wired up at the bottom of the script) will advance the
            // level and call init(), which will consume state.carryOver to
            // restore each player's weapons + invisibility timer.
            state.levelCleared = true;
            state.levelClearedTurns = state.turnsThisLevel;
            // First-try bonus: +300 awarded only if the player cleared
            // this level without dying or hitting Reset Level. The
            // diedThisLevel flag is set in the death-restore block below
            // and in resetCurrentLevel(), then reset to false in init().
            if (!state.diedThisLevel) {
              addScore(300, 'First-try Bonus!');
            }
            // Level-cleared award: a scaling bonus that grows by 100 every
            // level. Level 0 starts at 200, level 1 at 300, level 2 at 400,
            // and so on. The slow-clear penalty below is a separate line
            // item so players can see exactly why they lost points.
            const clearBonus = 200 + state.level * 100;
            addScore(clearBonus, `Cleared Level ${state.level + 1} Bonus`);
            // Slow-clear penalty: grace window = 2 × minTurns, with a
            // floor of minTurns + 20 so very short levels still feel
            // forgiving. Once turnsThisLevel passes that cutoff the
            // penalty is 5 points per turn beyond it (5, 10, 15…).
            // Skipped on randomized levels (computeMinTurnsToOut returns
            // '?' for level 6+), where there's no fair fixed minimum.
            const minTurns = computeMinTurnsToOut();
            if (typeof minTurns === 'number') {
              const graceCutoff = Math.max(2 * minTurns, minTurns + 20);
              if (state.turnsThisLevel > graceCutoff) {
                const penalty = 5 * (state.turnsThisLevel - graceCutoff);
                addScore(-penalty, 'Honestly, You Could Have Done Better');
              }
              // Min-turn bonus: clearing the level in exactly the BFS
              // optimum (or fewer, if the BFS undercounts an edge case)
              // is a +500 trophy. Random / complexBfs levels skip this
              // because computeMinTurnsToOut() returns '?' there.
              if (state.turnsThisLevel <= minTurns) {
                addScore(500, 'Minimum Turn Bonus!');
              }
            }
            // Stash items currently held so they survive the level rebuild.
            state.carryOver = state.players.map((pp) => ({
              weapons: pp.weapons || 0,
              invisibleTurnsLeft: pp.invisibleTurnsLeft || 0,
              potions: pp.potions || 0,
              keys: pp.keys || 0,
            }));
            // Remember which level was just cleared so the modal can
            // branch on it (e.g. final-level YOU WON treatment).
            state.lastClearedLevel = state.level;
            showLevelClearedModal();
            render();
            return;
          }
        }

        // Spider phase: each spider moves up to SPIDER_SPEED toward its closest player.
        if (state.winner === null) spiderPhase();

        // If a player got eaten this turn (in resolveSpidersOnPlayer above OR
        // during the spider phase that just ran), respawn all spiders to
        // their level-start positions, roll the rock layer back to its
        // level-start state, and restore env/weapons/potions/cakes so any
        // tnt detonations, lava-fills, and picked-up chests/cakes from
        // the failed run are undone. Keys + locks are intentionally NOT
        // reset — see the snapshot block in init() for the rationale.
        // The turn counter is intentionally NOT reset here either; only a
        // full level reset (Reset Level button or moving to the next
        // level) resets state.turnsThisLevel via init().
        if (state.respawnSpidersFlag) {
          state.respawnSpidersFlag = false;
          // Death zeroes-out the level score: the player loses every
          // point they earned during the failed attempt, and the level
          // breakdown starts fresh. Also marks the attempt as no
          // longer eligible for the first-try +300 bonus. The rolling
          // 5-entry global scoreLog is left alone (it's a recent-events
          // tape, not a per-level breakdown).
          if (typeof state.scoreAtLevelStart === 'number') {
            state.score = state.scoreAtLevelStart;
          }
          state.levelScoreEvents = [];
          state.diedThisLevel = true;
          state.spiders = state.spidersInitial.map((s) => ({
            c: s.c, r: s.r,
            alive: true,
            isBaby: false,
            babyTurnsLeft: 0,
            justBorn: false,
          }));
          state.rocks = state.rocksInitial.map((row) => row.slice());
          state.env = state.envInitial.map((row) => row.slice());
          state.weapons = state.weaponsInitial.map((row) => row.slice());
          state.potions = state.potionsInitial.map((row) => row.slice());
          state.cakes = state.cakesInitial.map((row) => row.slice());
          // Re-sync button _on flags against the restored rocks +
          // off-grid player positions. Without this, a button that was
          // pressed when the player died (and thus had b._on=true) would
          // appear pressed forever even though the board is now clear,
          // breaking the OFF→ON edge detection on the next press.
          rebaselineButtons();
        }

        // Tick the active player's invisibility timer at the end of *their* turn.
        if (p.invisibleTurnsLeft > 0) {
          p.invisibleTurnsLeft -= 1;
          if (p.invisibleTurnsLeft === 0 && p.status === 'on-grid') {
            state.pendingFx.push({ type: 'visible', c: p.c, r: p.r });
          }
        }

        // Advance turn (handles trap-skip and exited).
        nextTurn();
        render();
      }

      // Pass the turn to the next eligible player. Skips exited players and
      // consumes a single skipNext from a trapped player. If no other player is
      // eligible (everyone else exited), the current player keeps the turn.
      function nextTurn() {
        if (state.winner !== null) return;
        const n = state.players.length;
        if (n <= 1) return; // single-player: turn stays
        let next = state.currentPlayer;
        for (let i = 0; i < n; i++) {
          next = (next + 1) % n;
          if (next === state.currentPlayer) break;
          const np = state.players[next];
          if (np.status === 'exited') continue;
          if (np.skipNext) {
            np.skipNext = false;
            continue; // they lose this rotation
          }
          state.currentPlayer = next;
          return;
        }
        // Nobody else is eligible — keep the turn.
      }

      // Manually drink an Invisibility Potion from the active player's
      // inventory. Wired to the per-player Drink Potion HUD button and
      // the P keyboard shortcut. Does NOT consume a turn — the player
      // drinks the potion AND still has their full move that turn.
      // Guarded so it can't be triggered during animations, edit mode,
      // a won/cleared state, or while already invisible.
      function drinkPotion() {
        if (!state || !state.players || state.players.length === 0) return;
        if (state.editMode) return;
        if (state.winner !== null) return;
        if (state.levelCleared) return;
        if (state.animating) return;
        const p = state.players[state.currentPlayer];
        if (!p) return;
        if (p.status !== 'on-grid') return;
        if ((p.potions || 0) <= 0) return;
        // Don't waste a potion on a player who's already invisible —
        // refreshing the timer mid-flight would feel like double-paying.
        if (p.invisibleTurnsLeft > 0) return;
        p.potions -= 1;
        p.invisibleTurnsLeft = INVISIBILITY_TURNS;
        state.pendingFx.push({ type: 'invisible', c: p.c, r: p.r });
        render();
      }

      // ── Edit mode ────────────────────────────────────────────────────────
      // The edit toolbar (rendered in the edit-banner inside #board-wrap)
      // is wired to a simple state machine. Each click on a cell calls
      // onEditClick, which dispatches based on `editor.tool`. The Move
      // and Copy tools require two clicks (source then destination).
      // Walls and portals open a small floating direction picker so the
      // user can paint or edit which sides have bars.
      const EDITOR_DEFAULT_HINT = 'Pick a tool above. IN / OUT / Spider / items can be toggled. Walls and Portals open a direction picker.';
      const editor = {
        tool: 'erase',         // currently selected tool key from data-tool
        clipboard: null,       // { env, wallDirs, portalDirs, spiderCount, weapon, potion, cake, key, lock, rock }
        moveSrc: null,         // { c, r } for the Move tool
        wireSrc: null,         // { c, r } of the button currently being wired (Wire tool, second-pass clicks)
      };

      // Snapshot every editable layer at (c, r) into a plain object.
      // Used by Move / Copy.
      function snapshotCell(c, r) {
        const wd = state.wallDirs[r][c];
        const pd = state.portalDirs[r][c];
        const rd = state.riverDirs[r][c];
        // If there's a Button at this cell, capture its wired targets so
        // Move/Copy preserves the wiring. Targets reference absolute board
        // coords; on Copy-paste the user can re-wire to local targets if
        // they want, but at least the data isn't lost.
        const btn = (state.buttons || []).find((b) => b.c === c && b.r === r);
        return {
          env: state.env[r][c] || 'neutral',
          wallDirs: wd ? wd.map((d) => ({ dc: d.dc, dr: d.dr })) : null,
          portalDirs: pd ? { dc: pd.dc, dr: pd.dr } : null,
          riverDirs: rd ? { dc: rd.dc, dr: rd.dr } : null,
          spiderCount: state.spiders.filter((s) => s.alive && s.c === c && s.r === r).length,
          weapon: !!state.weapons[r][c],
          potion: !!state.potions[r][c],
          cake:   !!state.cakes[r][c],
          key:    !!state.keys[r][c],
          lock:   !!state.locks[r][c],
          rock:   !!state.rocks[r][c],
          button: btn ? { targets: btn.targets.map((t) => ({ c: t.c, r: t.r })) } : null,
        };
      }

      // Wipe every editable layer at (c, r) — env, wall/portal direction
      // metadata, items, spiders, rocks, locks, keys. Used by the Eraser
      // and as the first step of Move.
      function clearCell(c, r) {
        state.env[r][c] = 'neutral';
        state.wallDirs[r][c] = null;
        state.portalDirs[r][c] = null;
        state.riverDirs[r][c] = null;
        state.weapons[r][c] = false;
        state.potions[r][c] = false;
        state.cakes[r][c] = false;
        state.keys[r][c] = false;
        state.locks[r][c] = false;
        state.rocks[r][c] = false;
        // Remove any spiders standing here.
        state.spiders = state.spiders.filter((s) => !(s.c === c && s.r === r));
        // Remove any Button entry at this cell. Also strip this cell out
        // of every other button's targets list so we don't leave dangling
        // wire endpoints pointing into an erased cell.
        if (state.buttons && state.buttons.length) {
          state.buttons = state.buttons.filter((b) => !(b.c === c && b.r === r));
          for (const b of state.buttons) {
            b.targets = b.targets.filter((t) => !(t.c === c && t.r === r));
          }
        }
      }

      // Apply a snapshot to (c, r). For spiders we replace the count at
      // the destination with the count from the snapshot.
      function applySnapshot(c, r, snap) {
        state.env[r][c] = snap.env;
        state.wallDirs[r][c] = snap.wallDirs ? snap.wallDirs.map((d) => ({ dc: d.dc, dr: d.dr })) : null;
        state.portalDirs[r][c] = snap.portalDirs ? { dc: snap.portalDirs.dc, dr: snap.portalDirs.dr } : null;
        state.riverDirs[r][c] = snap.riverDirs ? { dc: snap.riverDirs.dc, dr: snap.riverDirs.dr } : null;
        state.weapons[r][c] = !!snap.weapon;
        state.potions[r][c] = !!snap.potion;
        state.cakes[r][c]   = !!snap.cake;
        state.keys[r][c]    = !!snap.key;
        state.locks[r][c]   = !!snap.lock;
        state.rocks[r][c]   = !!snap.rock;
        // Drop any existing spiders at the destination first, then add
        // however many the snapshot carried.
        state.spiders = state.spiders.filter((s) => !(s.c === c && s.r === r));
        for (let i = 0; i < (snap.spiderCount || 0); i++) {
          state.spiders.push({
            c, r,
            alive: true,
            isBaby: false,
            babyTurnsLeft: 0,
            justBorn: false,
          });
        }
        // Buttons live in a side list, not the per-cell layer grid. First
        // remove any existing button at the destination so we don't get a
        // duplicate, then re-add from the snapshot if present.
        if (state.buttons && state.buttons.length) {
          state.buttons = state.buttons.filter((b) => !(b.c === c && b.r === r));
        }
        if (snap.button) {
          state.buttons = state.buttons || [];
          state.buttons.push({
            c, r,
            targets: (snap.button.targets || []).map((t) => ({ c: t.c, r: t.r })),
            _on: false,
          });
        }
      }

      // Refresh the .edit-source highlight on the board (used for Move/Copy).
      function syncEditSourceHighlight() {
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const el = cellEls[r] && cellEls[r][c];
            if (el) el.classList.remove('edit-source');
          }
        }
        const src = editor.tool === 'move' ? editor.moveSrc
                  : editor.tool === 'copy' ? editor.clipboard && editor.clipboard.__src
                  : null;
        if (src) {
          const el = cellEls[src.r] && cellEls[src.r][src.c];
          if (el) el.classList.add('edit-source');
        }
      }

      function setEditHint(text) {
        const hint = document.getElementById('edit-hint');
        if (hint) hint.textContent = text || EDITOR_DEFAULT_HINT;
      }

      // Live button-wire info panel. Reads editor.tool + editor.wireSrc
      // to decide whether to show the panel, then walks the wireSrc's
      // targets[] and computes a short effect label for each one based
      // on the target cell's current contents:
      //   • env === 'tnt'   → "Detonate TnT (one-shot, consumes target)"
      //   • locks[r][c]     → "Hold lock open while pressed"
      //   • env === 'portal-r' → "Turn Red Portal → Yellow while pressed"
      //   • anything else   → "No effect — place a TnT, Lock, or Red Portal here"
      // Wire targets that span multiple effects (e.g. a Lock sitting on
      // a TnT cell) get every applicable line so the user understands
      // what the button will fire. Re-rendered every render() pass so
      // the description stays in sync as targets are added or moved.
      function renderButtonWireInfo() {
        const panel = document.getElementById('button-wire-info');
        if (!panel) return;
        const active = state.editMode
          && editor.tool === 'wire-button'
          && editor.wireSrc
          && inBounds(editor.wireSrc.c, editor.wireSrc.r);
        if (!active) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
        const src = editor.wireSrc;
        const targets = src.targets || [];
        let html = '<div class="bwi-title">Button at ('
          + (src.c + 1) + ', ' + (src.r + 1)
          + ') — choose target cells</div>';
        if (!targets.length) {
          html += '<div class="bwi-empty">No targets yet. Click any cell on the board to add it. Effects: TnT detonates, Lock is held open, Red Portal turns Yellow.</div>';
        } else {
          html += '<ul class="bwi-list">';
          for (const t of targets) {
            const coord = '(' + (t.c + 1) + ', ' + (t.r + 1) + ')';
            const effects = [];
            if (inBounds(t.c, t.r)) {
              if (state.env[t.r] && state.env[t.r][t.c] === 'tnt') {
                effects.push('<span class="bwi-effect-tnt">💥 Detonate TnT on press</span>');
              }
              if (state.locks[t.r] && state.locks[t.r][t.c]) {
                effects.push('<span class="bwi-effect-lock">🔓 Hold lock open while pressed</span>');
              }
              if (state.env[t.r] && state.env[t.r][t.c] === 'portal-r') {
                effects.push('<span class="bwi-effect-portal">🟡 Turn Red Portal → Yellow while pressed</span>');
              }
            }
            if (!effects.length) {
              effects.push('<span class="bwi-effect-none">No effect — place TnT, Lock, or Red Portal here</span>');
            }
            html += '<li><span class="bwi-coord">' + coord + '</span> — ' + effects.join('; ') + '</li>';
          }
          html += '</ul>';
        }
        html += '<div class="bwi-finish">Click the button cell again to finish wiring.</div>';
        panel.innerHTML = html;
        panel.classList.remove('hidden');
      }

      // Wipe the live grid back to a blank 10×10 canvas: every cell
      // becomes neutral (no env, no walls, no portals, no rivers, no
      // items, no spiders, no rocks, no locks, no keys), IN snaps to
      // (1, 1) and OUT snaps to (10, 10). Keeps state.level unchanged so
      // the user can later Save layout into any slot they like. If the
      // grid already contains content, prompt for confirmation first so
      // a stray click doesn't nuke a half-finished design. Players are
      // sent off-grid and the BFS cache is invalidated so Min-N updates.
      function startBlankLayout() {
        // Detect any existing content (env, items, spiders, rocks, locks,
        // keys, walls, portals, rivers, or non-default IN/OUT).
        let hasContent = false;
        for (let r = 0; r < ROWS && !hasContent; r++) {
          for (let c = 0; c < COLS && !hasContent; c++) {
            if (state.env[r][c] && state.env[r][c] !== 'neutral') hasContent = true;
            else if (state.weapons[r][c] || state.potions[r][c] || state.cakes[r][c]) hasContent = true;
            else if (state.keys[r][c] || state.locks[r][c] || state.rocks[r][c]) hasContent = true;
            else if (state.wallDirs[r][c] || state.portalDirs[r][c]) hasContent = true;
            else if (state.riverDirs[r][c]) hasContent = true;
          }
        }
        if (state.spiders.some((s) => s.alive)) hasContent = true;
        if (state.buttons && state.buttons.length) hasContent = true;
        if (IN_CELL.c !== 0 || IN_CELL.r !== 0) hasContent = true;
        if (OUT_CELL.c !== DEFAULT_OUT_CELL.c || OUT_CELL.r !== DEFAULT_OUT_CELL.r) hasContent = true;

        if (hasContent) {
          const ok = window.confirm(
            'Start a new blank 10×10 layout? This will erase the current grid (it won\u2019t touch saved layouts).'
          );
          if (!ok) return;
        }

        // Wipe every cell layer in place. Use existing clearCell so we
        // stay consistent with eraser semantics (also drops spiders
        // standing on each wiped cell).
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            clearCell(c, r);
          }
        }
        // Defensive — clearCell removes per-cell spiders but we want a
        // hard reset of the spider list either way.
        state.spiders = [];
        state.spidersInitial = [];
        // Same for buttons — blank the side list explicitly.
        state.buttons = [];
        // Reset IN / OUT to defaults.
        IN_CELL.c = 0; IN_CELL.r = 0;
        OUT_CELL.c = DEFAULT_OUT_CELL.c;
        OUT_CELL.r = DEFAULT_OUT_CELL.r;
        // Send any on-grid players back off-grid so the puck repositions
        // correctly when the user leaves edit mode.
        for (const pl of state.players) {
          if (pl.status === 'on-grid') pl.status = 'off-grid';
        }
        // Refresh the *Initial snapshots so a death-respawn during a
        // future play-through doesn't restore stale level content.
        state.envInitial = state.env.map((row) => row.slice());
        state.weaponsInitial = state.weapons.map((row) => row.slice());
        state.potionsInitial = state.potions.map((row) => row.slice());
        state.cakesInitial = state.cakes.map((row) => row.slice());
        state.rocksInitial = state.rocks.map((row) => row.slice());
        // Invalidate the BFS cache so Min-N recomputes on next render.
        state._minTurnsCache = null;
        // Clear any in-flight editor selection state.
        editor.tool = null;
        editor.moveSrc = null;
        editor.wireSrc = null;
        editor.clipboard = null;
        hideDirPicker();
        const toolbar = document.getElementById('edit-tools');
        if (toolbar) {
          toolbar.querySelectorAll('.edit-tool').forEach((btn) => {
            btn.classList.remove('active');
          });
        }
        setEditHint('Blank 10×10 grid. Pick a tool, then click cells to design your level.');
        render();
      }

      function selectTool(tool) {
        // Save-layout is a one-shot action button that lives in the
        // toolbar but doesn't change the active paint tool — it just
        // opens the save modal and bails out.
        if (tool === 'save-layout') {
          openSaveLayoutModal();
          return;
        }
        // New-layout is also a one-shot action: wipe every cell back to
        // defaults so the user can design from a blank 10×10 grid. Asks
        // for confirmation if the current layout has any content.
        if (tool === 'new-layout') {
          startBlankLayout();
          return;
        }
        // Playtest: capture the current draft into a scratch slot,
        // exit edit mode, and re-init from that snapshot. Reset Level
        // will keep replaying the same draft until the user clicks
        // EDIT MODE again (which exits playtest and restores the draft
        // to the editor grid).
        if (tool === 'playtest') {
          enterPlaytestMode();
          return;
        }
        editor.tool = tool;
        // Reset transient selections when switching tools.
        editor.moveSrc = null;
        // Switching tools cancels in-progress wiring so the user has a
        // clean slate (and we don't leave a stale wire-source highlight).
        editor.wireSrc = null;
        editor.clipboard = null;
        hideDirPicker();
        // Update active-state on the toolbar buttons.
        const toolbar = document.getElementById('edit-tools');
        if (toolbar) {
          toolbar.querySelectorAll('.edit-tool').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
          });
        }
        // Per-tool hint copy.
        const hints = {
          'env-green-knight': 'Green Knight — click a cell to set it (or click again to clear). Jumps 2 forward + 1 LEFT (mirror of regular Knight).',
          'erase': 'Eraser — click any cell to wipe its env, items, spiders, rocks, locks, keys.',
          'env-slide': 'Slide — click a cell to set it (or click again to clear).',
          'env-river': 'River — click a cell, then pick the flow direction in the popover.',
          'env-knight': 'Knight — click a cell to set it (or click again to clear).',
          'env-lava': 'Lava — click a cell to set it (or click again to clear).',
          'env-tnt': 'TnT — click a cell to set it (or click again to clear).',
          'env-boulder': 'Boulder — click a cell to set it (or click again to clear).',
          'env-tree': 'Tree — click a cell to set it (or click again to clear). Items underneath are hidden; players hiding here are invisible to spiders; rocks can’t be pushed into a tree.',
          'env-button': 'Button — click an empty cell to place a button (or click an existing button to remove it). After placing, Wire mode opens automatically: click each target cell, then click the Button again to confirm the wiring.',
          'wire-button': 'Wire (3 steps): 1) Click a Button cell. 2) Click each target cell. 3) Click the same Button again to confirm. Targets: TnT detonates on press, Lock is held open while pressed, Red Portal turns Yellow while pressed.',
          'env-wall': 'Wall — click a cell to place; the direction picker lets you toggle which sides have bars.',
          'env-portal': 'Purple Portal — click a cell, then pick the bar direction in the popover.',
          'env-portal-y': 'Yellow Portal — click a cell, then pick the bar direction in the popover.',
          'env-portal-b': 'Blue Portal — click a cell, then pick the bar direction in the popover.',
          'env-portal-r': 'Red Portal — click a cell, then pick the bar direction in the popover.',
          'item-weapon': 'Knife — click to toggle a chest with a Spider Knife.',
          'item-potion': 'Potion — click to toggle a chest with a Spider Freeze Potion.',
          'item-cake': 'Cake — click to toggle a cake (+100 on pickup).',
          'item-key': 'Key — click to toggle a key on the cell.',
          'item-lock': 'Lock — click to toggle a lock cage on the cell.',
          'item-rock': 'Rock — click to toggle a pushable rock.',
          'spider': 'Spider — click to add a spider; click an occupied cell to remove one.',
          'in': 'Move IN — click any non-OUT cell to relocate the IN gate.',
          'out': 'Move OUT — click any non-IN cell to relocate the OUT gate.',
          'move': 'Move — click the SOURCE cell, then click the DESTINATION cell.',
          'copy': 'Copy — click the SOURCE cell, then click any number of destination cells. Switch tools to clear the clipboard.',
        };
        setEditHint(hints[tool] || EDITOR_DEFAULT_HINT);
        syncEditSourceHighlight();
      }

      function onEditClick(c, r) {
        if (!inBounds(c, r)) return;
        if (!state.editMode) return;
        // Any edit can change the level layout, so invalidate the BFS
        // cache so the next render() recomputes Min N from scratch.
        state._minTurnsCache = null;
        // Mark the session dirty. False positives (e.g., clicking IN/OUT
        // with the wrong tool) are an acceptable trade — better to over-
        // prompt than to silently drop edits. Cleared by confirmSaveLayout
        // and by toggleEditMode on entry.
        state.editorDirty = true;
        syncDirtyBadge();
        // Keep players from being painted over (avoids confusion).
        for (const pl of state.players) {
          if (pl.status === 'on-grid' && pl.c === c && pl.r === r) return;
        }
        // The Move/Copy/IN/OUT/Spider/Item tools each branch separately;
        // env tools share a small toggle helper that also opens the
        // direction picker for walls and portals.
        const tool = editor.tool;

        // Move IN / OUT.
        if (tool === 'in') {
          if (isOutCell(c, r)) { setEditHint('That cell is OUT — pick a different cell.'); return; }
          IN_CELL.c = c;
          IN_CELL.r = r;
          // Re-snap any off-grid players so the staging puck repositions.
          render();
          return;
        }
        if (tool === 'out') {
          if (isInCell(c, r)) { setEditHint('That cell is IN — pick a different cell.'); return; }
          OUT_CELL.c = c;
          OUT_CELL.r = r;
          render();
          return;
        }

        // Lock on OUT: explicitly allowed (handled before the IN/OUT
        // read-only guard below). legalMoves + the movePlayer key-consume
        // path already account for a locked OUT cell — the player needs
        // a key (or a button-held-open lock) to step onto it and exit.
        // Lock-on-IN is still disallowed because the player can't enter
        // the grid at all if IN is locked.
        if (tool === 'item-lock' && isOutCell(c, r)) {
          state.locks[r][c] = !state.locks[r][c];
          render();
          return;
        }

        // From here on, IN / OUT are off-limits (env edits / items / spiders
        // / move / copy all skip them).
        if (isInOrOut(c, r)) {
          setEditHint('IN and OUT cells are read-only. Use the Move IN / Move OUT tools to relocate them.');
          return;
        }

        // Eraser.
        if (tool === 'erase') {
          clearCell(c, r);
          render();
          return;
        }

        // Move: first click captures the source, second click drops it.
        if (tool === 'move') {
          if (!editor.moveSrc) {
            const snap = snapshotCell(c, r);
            const empty = snap.env === 'neutral' && !snap.weapon && !snap.potion
                        && !snap.cake && !snap.key && !snap.lock && !snap.rock
                        && snap.spiderCount === 0;
            if (empty) { setEditHint('Source cell is empty — pick a cell that has something on it.'); return; }
            editor.moveSrc = { c, r };
            setEditHint(`Move: source = (${c + 1}, ${r + 1}). Now click the destination.`);
            syncEditSourceHighlight();
            return;
          }
          const src = editor.moveSrc;
          if (src.c === c && src.r === r) {
            // Click the source again to cancel.
            editor.moveSrc = null;
            setEditHint('Move cancelled.');
            syncEditSourceHighlight();
            return;
          }
          const snap = snapshotCell(src.c, src.r);
          clearCell(src.c, src.r);
          applySnapshot(c, r, snap);
          editor.moveSrc = null;
          setEditHint(`Moved (${src.c + 1}, ${src.r + 1}) → (${c + 1}, ${r + 1}).`);
          syncEditSourceHighlight();
          render();
          return;
        }

        // Copy: first click captures the source, subsequent clicks paste.
        if (tool === 'copy') {
          if (!editor.clipboard) {
            const snap = snapshotCell(c, r);
            const empty = snap.env === 'neutral' && !snap.weapon && !snap.potion
                        && !snap.cake && !snap.key && !snap.lock && !snap.rock
                        && snap.spiderCount === 0;
            if (empty) { setEditHint('Source cell is empty — pick a cell that has something on it.'); return; }
            snap.__src = { c, r };
            editor.clipboard = snap;
            setEditHint(`Copy: source = (${c + 1}, ${r + 1}). Click any cell to paste — switch tools to stop.`);
            syncEditSourceHighlight();
            return;
          }
          const snap = editor.clipboard;
          // Strip the source-coord helper before applying.
          const { __src, ...applyable } = snap;
          applySnapshot(c, r, applyable);
          setEditHint(`Pasted at (${c + 1}, ${r + 1}). Click another cell to paste again.`);
          render();
          return;
        }

        // Spider: toggle a single spider on the cell. Cells already
        // occupied by an env hazard are still allowed (level designs
        // sometimes need a spider on a slide etc.).
        if (tool === 'spider') {
          const idx = state.spiders.findIndex((s) => s.alive && s.c === c && s.r === r);
          if (idx >= 0) {
            state.spiders.splice(idx, 1);
            setEditHint(`Removed a spider at (${c + 1}, ${r + 1}).`);
          } else {
            state.spiders.push({
              c, r,
              alive: true,
              isBaby: false,
              babyTurnsLeft: 0,
              justBorn: false,
            });
            setEditHint(`Added a spider at (${c + 1}, ${r + 1}).`);
          }
          render();
          return;
        }

        // Item toggles. Each tool flips a single boolean layer.
        if (tool === 'item-weapon') { state.weapons[r][c] = !state.weapons[r][c]; render(); return; }
        if (tool === 'item-potion') { state.potions[r][c] = !state.potions[r][c]; render(); return; }
        if (tool === 'item-cake')   { state.cakes[r][c]   = !state.cakes[r][c];   render(); return; }
        if (tool === 'item-key')    { state.keys[r][c]    = !state.keys[r][c];    render(); return; }
        if (tool === 'item-lock')   { state.locks[r][c]   = !state.locks[r][c];   render(); return; }
        if (tool === 'item-rock')   { state.rocks[r][c]   = !state.rocks[r][c];   render(); return; }

        // Wire tool. Two-pass interaction:
        //   1) First click must be a button cell — that button becomes
        //      editor.wireSrc (highlighted by the render pass).
        //   2) Subsequent clicks toggle the clicked cell in/out of the
        //      wireSrc button's targets array.
        //   3) Clicking the wireSrc button itself again clears wireSrc
        //      so the user can wire a different button without switching
        //      tools.
        if (tool === 'wire-button') {
          if (!editor.wireSrc) {
            const btn = (state.buttons || []).find((b) => b.c === c && b.r === r);
            if (!btn) {
              setEditHint('Wire step 1: click a Button cell first. (Then click each target, then click the Button again to confirm.)');
              return;
            }
            editor.wireSrc = btn;
            setEditHint('Wire step 2: click each target cell (TnT, Lock, or Red Portal). Step 3: click the Button again to confirm.');
            render();
            return;
          }
          // Second-pass click. If it's the wire source again, finish wiring.
          // Successful finish requires >= 1 target. If zero targets are set
          // we still clear wireSrc (so the user isn't stuck) but flash a
          // warning toast + hint so they know nothing was wired.
          if (editor.wireSrc.c === c && editor.wireSrc.r === r) {
            const finished = editor.wireSrc;
            const tcount = (finished.targets || []).length;
            editor.wireSrc = null;
            if (tcount > 0) {
              state.pendingFx.push({ type: 'wire-confirmed', c: finished.c, r: finished.r, count: tcount });
              setEditHint('✓ Button at (' + (finished.c + 1) + ', ' + (finished.r + 1)
                + ') wired to ' + tcount + ' target' + (tcount === 1 ? '' : 's')
                + '. Click another Button to start wiring it.');
            } else {
              state.pendingFx.push({ type: 'wire-empty', c: finished.c, r: finished.r });
              setEditHint('⚠ No targets set — nothing wired. Click the Button again, then click target cells (TnT, Lock, Red Portal), then click the Button to confirm.');
            }
            render();
            return;
          }
          // Otherwise toggle the cell as a target of editor.wireSrc.
          const tgts = editor.wireSrc.targets;
          const idx = tgts.findIndex((t) => t.c === c && t.r === r);
          if (idx >= 0) {
            tgts.splice(idx, 1);
          } else {
            tgts.push({ c, r });
          }
          render();
          return;
        }

        // Button env. Owns its own toggle because state.buttons[] is a
        // side list, not part of the per-cell env layer alone — we have
        // to keep both in sync.
        if (tool === 'env-button') {
          const cur = state.env[r][c];
          if (cur === 'button') {
            // Toggle off. Drop the cell's env back to neutral AND remove
            // the matching state.buttons entry. Also remove this cell as
            // a target of any other button.
            state.env[r][c] = 'neutral';
            if (state.buttons && state.buttons.length) {
              state.buttons = state.buttons.filter((b) => !(b.c === c && b.r === r));
              for (const b of state.buttons) {
                b.targets = b.targets.filter((t) => !(t.c === c && t.r === r));
              }
            }
            // If we just removed the cell that was being wired, cancel
            // the in-progress wire selection too.
            if (editor.wireSrc && editor.wireSrc.c === c && editor.wireSrc.r === r) {
              editor.wireSrc = null;
            }
            render();
            return;
          }
          // Place a fresh button on this cell. Wipe other env metadata
          // so an old wall/portal/river config doesn't leak through.
          state.env[r][c] = 'button';
          state.wallDirs[r][c] = null;
          state.portalDirs[r][c] = null;
          state.riverDirs[r][c] = null;
          state.buttons = state.buttons || [];
          // De-dup: if for some reason an entry already exists at this
          // cell (shouldn't, since env wasn't 'button'), drop it first.
          state.buttons = state.buttons.filter((b) => !(b.c === c && b.r === r));
          const newBtn = { c, r, targets: [], _on: false };
          state.buttons.push(newBtn);
          // Auto-switch to wire mode with this button selected so the
          // user is immediately prompted to choose targets. The wire
          // hint panel (rendered by updateButtonWireHint, called from
          // render()) shows the per-target effect description live as
          // targets are added/removed.
          editor.tool = 'wire-button';
          editor.wireSrc = newBtn;
          const toolbar = document.getElementById('edit-tools');
          if (toolbar) {
            toolbar.querySelectorAll('.edit-tool').forEach((b) => {
              b.classList.toggle('active', b.dataset.tool === 'wire-button');
            });
          }
          render();
          return;
        }

        // Env tools — shared logic. Click again to clear; otherwise paint.
        if (tool && tool.startsWith('env-')) {
          const envKey = tool.slice('env-'.length); // 'slide' | 'knight' | 'lava' | 'tnt' | 'boulder' | 'wall' | 'portal' | 'portal-y' | 'portal-b' | 'portal-r' | 'portal-g'
          const cur = state.env[r][c];
          // If we're painting a NON-button env over a cell that's currently
          // a Button, remove the Button entry from the side list so we
          // don't leave a phantom button that still fires its targets.
          if (cur === 'button' && envKey !== 'button') {
            if (state.buttons && state.buttons.length) {
              state.buttons = state.buttons.filter((b) => !(b.c === c && b.r === r));
              for (const b of state.buttons) {
                b.targets = b.targets.filter((t) => !(t.c === c && t.r === r));
              }
            }
            if (editor.wireSrc && editor.wireSrc.c === c && editor.wireSrc.r === r) {
              editor.wireSrc = null;
            }
          }
          if (cur === envKey) {
            // Toggle off — but for walls/portals/rivers, open the picker
            // instead of clearing, so a stray click doesn't wipe a
            // configured direction.
            if (envKey === 'wall' || isPortalKey(envKey) || envKey === 'river') {
              showDirPicker(c, r);
              return;
            }
            state.env[r][c] = 'neutral';
            render();
            return;
          }
          state.env[r][c] = envKey;
          if (envKey === 'wall') {
            // Default to all four sides blocked so the wall is visible
            // immediately; user can untoggle in the picker.
            state.wallDirs[r][c] = state.wallDirs[r][c] && state.wallDirs[r][c].length
              ? state.wallDirs[r][c]
              : [{ dc:0, dr:-1 }, { dc:0, dr:1 }, { dc:-1, dr:0 }, { dc:1, dr:0 }];
            state.portalDirs[r][c] = null;
            state.riverDirs[r][c] = null;
            render();
            showDirPicker(c, r);
            return;
          }
          if (isPortalKey(envKey)) {
            state.portalDirs[r][c] = state.portalDirs[r][c] || { dc: 0, dr: -1 };
            state.wallDirs[r][c] = null;
            state.riverDirs[r][c] = null;
            render();
            showDirPicker(c, r);
            return;
          }
          if (envKey === 'river') {
            state.riverDirs[r][c] = state.riverDirs[r][c] || { dc: 1, dr: 0 };
            state.wallDirs[r][c] = null;
            state.portalDirs[r][c] = null;
            render();
            showDirPicker(c, r);
            return;
          }
          // Plain env types — clear any leftover wall/portal/river metadata.
          state.wallDirs[r][c] = null;
          state.portalDirs[r][c] = null;
          state.riverDirs[r][c] = null;
          render();
          return;
        }
      }

      // ── Direction picker ─────────────────────────────────────────────────
      // Shown after a wall or portal is placed (or when the user clicks an
      // existing wall/portal cell with the matching tool). Walls let the
      // user toggle 1–4 sides; portals are exclusive (a single direction).
      const DIR_DEFS = [
        { key: 'up',    dc: 0,  dr: -1, glyph: '↑' },
        { key: 'down',  dc: 0,  dr:  1, glyph: '↓' },
        { key: 'left',  dc: -1, dr:  0, glyph: '←' },
        { key: 'right', dc: 1,  dr:  0, glyph: '→' },
      ];
      let dirPickerCtx = null; // { c, r, kind: 'wall' | 'portal' }

      function hideDirPicker() {
        const dp = document.getElementById('dir-picker');
        if (dp) {
          dp.classList.add('hidden');
          dp.setAttribute('aria-hidden', 'true');
        }
        dirPickerCtx = null;
      }

      function dirsEqual(a, b) {
        return a && b && a.dc === b.dc && a.dr === b.dr;
      }

      function hasWallDir(c, r, def) {
        const arr = state.wallDirs[r][c] || [];
        return arr.some((d) => d.dc === def.dc && d.dr === def.dr);
      }

      function toggleWallDir(c, r, def) {
        const arr = state.wallDirs[r][c] || [];
        const idx = arr.findIndex((d) => d.dc === def.dc && d.dr === def.dr);
        if (idx >= 0) {
          arr.splice(idx, 1);
        } else {
          arr.push({ dc: def.dc, dr: def.dr });
        }
        state.wallDirs[r][c] = arr;
      }

      function setPortalDir(c, r, def) {
        state.portalDirs[r][c] = { dc: def.dc, dr: def.dr };
      }

      function setRiverDir(c, r, def) {
        state.riverDirs[r][c] = { dc: def.dc, dr: def.dr };
      }

      function showDirPicker(c, r) {
        const env = state.env[r] && state.env[r][c];
        const isWall = env === 'wall';
        const isPortal = isPortalKey(env);
        const isRiver = env === 'river';
        if (!isWall && !isPortal && !isRiver) { hideDirPicker(); return; }
        dirPickerCtx = { c, r, kind: isWall ? 'wall' : (isRiver ? 'river' : 'portal') };

        const dp = document.getElementById('dir-picker');
        if (!dp) return;
        dp.innerHTML = '';

        const title = document.createElement('div');
        title.className = 'dir-title';
        title.textContent = isWall ? 'Wall sides' : (isRiver ? 'River flow' : 'Portal bar');
        dp.appendChild(title);

        // 3x3 cluster: empty / up / empty // left / center / right // empty / down / empty.
        const cluster = [
          { gridColumn: 1, gridRow: 2, def: null }, // spacer
          { gridColumn: 2, gridRow: 2, def: DIR_DEFS[0] }, // up
          { gridColumn: 3, gridRow: 2, def: null }, // spacer
          { gridColumn: 1, gridRow: 3, def: DIR_DEFS[2] }, // left
          { gridColumn: 2, gridRow: 3, def: null }, // spacer (cell glyph)
          { gridColumn: 3, gridRow: 3, def: DIR_DEFS[3] }, // right
          { gridColumn: 1, gridRow: 4, def: null }, // spacer
          { gridColumn: 2, gridRow: 4, def: DIR_DEFS[1] }, // down
          { gridColumn: 3, gridRow: 4, def: null }, // spacer
        ];
        for (const slot of cluster) {
          if (!slot.def) {
            const sp = document.createElement('span');
            sp.className = 'dir-spacer';
            if (slot.gridColumn === 2 && slot.gridRow === 3) {
              // Center marker shows the cell glyph for orientation.
              sp.textContent = isWall ? '▦'
                : isRiver ? '≈'
                : env === 'portal'   ? '◐'
                : env === 'portal-y' ? '◑'
                : env === 'portal-b' ? '◒'
                : env === 'portal-r' ? '◓'
                : '◔'; // portal-g
              sp.style.fontSize = '14px';
              sp.style.opacity = '0.6';
            }
            sp.style.gridColumn = String(slot.gridColumn);
            sp.style.gridRow = String(slot.gridRow);
            dp.appendChild(sp);
            continue;
          }
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'dir-btn';
          btn.dataset.dir = slot.def.key;
          btn.textContent = slot.def.glyph;
          btn.style.gridColumn = String(slot.gridColumn);
          btn.style.gridRow = String(slot.gridRow);
          // Initial active state.
          if (isWall) {
            btn.classList.toggle('active', hasWallDir(c, r, slot.def));
          } else if (isRiver) {
            btn.classList.toggle('active', dirsEqual(state.riverDirs[r][c], { dc: slot.def.dc, dr: slot.def.dr }));
          } else {
            btn.classList.toggle('active', dirsEqual(state.portalDirs[r][c], { dc: slot.def.dc, dr: slot.def.dr }));
          }
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!dirPickerCtx) return;
            if (isWall) {
              toggleWallDir(c, r, slot.def);
            } else if (isRiver) {
              setRiverDir(c, r, slot.def);
            } else {
              setPortalDir(c, r, slot.def);
            }
            // Re-sync sibling buttons (for portal/river exclusivity) and re-render.
            for (const sib of dp.querySelectorAll('.dir-btn')) {
              const key = sib.dataset.dir;
              const def = DIR_DEFS.find((d) => d.key === key);
              if (!def) continue;
              if (isWall) {
                sib.classList.toggle('active', hasWallDir(c, r, def));
              } else if (isRiver) {
                sib.classList.toggle('active', dirsEqual(state.riverDirs[r][c], { dc: def.dc, dr: def.dr }));
              } else {
                sib.classList.toggle('active', dirsEqual(state.portalDirs[r][c], { dc: def.dc, dr: def.dr }));
              }
            }
            render();
          });
          dp.appendChild(btn);
        }

        // Action row: Done / Clear cell.
        const actions = document.createElement('div');
        actions.className = 'dir-actions';
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear cell';
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!dirPickerCtx) return;
          clearCell(dirPickerCtx.c, dirPickerCtx.r);
          hideDirPicker();
          render();
        });
        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'primary';
        doneBtn.textContent = 'Done';
        doneBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          hideDirPicker();
        });
        actions.appendChild(clearBtn);
        actions.appendChild(doneBtn);
        dp.appendChild(actions);

        // Position the popover near the clicked cell. Falls back to
        // centering near the board if anchor lookup fails.
        const cellEl = cellEls[r] && cellEls[r][c];
        const rect = cellEl ? cellEl.getBoundingClientRect() : null;
        const dpW = 130;
        if (rect) {
          let left = rect.right + 8;
          let top = rect.top;
          if (left + dpW > window.innerWidth - 8) {
            left = Math.max(8, rect.left - dpW - 8);
          }
          if (top + 200 > window.innerHeight - 8) {
            top = Math.max(8, window.innerHeight - 210);
          }
          dp.style.left = left + 'px';
          dp.style.top = top + 'px';
        } else {
          dp.style.left = '50%';
          dp.style.top = '50%';
          dp.style.transform = 'translate(-50%, -50%)';
        }

        dp.classList.remove('hidden');
        dp.setAttribute('aria-hidden', 'false');
      }

      // Update the Edit Mode launcher button's two-line label between
      // "EDIT MODE / Design your own level!" (idle) and
      // "DONE EDITING / Back to playing" (active). Falls back to setting
      // textContent on legacy markup if the new spans aren't present.
      function setEditButtonLabel(active) {
        const btn = document.getElementById('edit-btn');
        if (!btn) return;
        const title = btn.querySelector('.edit-mode-btn-title');
        const sub = btn.querySelector('.edit-mode-btn-sub');
        if (title && sub) {
          if (active) {
            title.textContent = 'DONE EDITING';
            sub.textContent = 'Back to playing';
          } else {
            title.textContent = 'EDIT MODE';
            sub.textContent = 'Design your own level!';
          }
        } else {
          btn.textContent = active ? 'Done editing' : 'Edit cells';
        }
      }

      function toggleEditMode() {
        const entering = !state.editMode;
        if (entering) {
          // Guard against destroying unsaved edits that survived a
          // prior "Done Editing" exit. Done Editing leaves the visual
          // grid intact but doesn't persist anything — the next call
          // to resetCurrentLevel() / init() wipes them. Prompt before
          // we do that.
          if (state.editorDirty) {
            const ok = window.confirm(
              'You have unsaved edits from a previous edit session.\n\n' +
              'Re-entering edit mode resets the level and will discard them.\n\n' +
              'Click OK to discard and re-enter, or Cancel to stay in play mode (open Save Layout from the toolbar first to keep them).'
            );
            if (!ok) return;
          }
          // Reset the level FIRST so the editor sees a fresh board (no
          // spiders, no in-flight animation, no partial state).
          // resetCurrentLevel() calls init() which clears editMode and
          // wipes the body class, so we re-enable edit-mode after the
          // reset finishes.
          if (typeof resetCurrentLevel === 'function') {
            resetCurrentLevel();
          }
          state.editMode = true;
          // Fresh edit session starts clean.
          state.editorDirty = false;
          syncDirtyBadge();
          document.body.classList.add('edit-mode');
          setEditButtonLabel(true);
          // Default to the eraser so a fresh entry to edit-mode doesn't
          // immediately repaint cells under accidental clicks.
          selectTool(editor.tool || 'erase');
          render();
        } else {
          state.editMode = false;
          // NOTE: do NOT clear editorDirty here. Done Editing leaves the
          // visual grid intact, so the user reasonably thinks their
          // edits are still around — they are, but only in transient
          // state.env / state.buttons / etc. The dirty flag must
          // survive so the next destructive action (Reset Level,
          // level-jump, Re-enter Edit Mode, page reload) can prompt.
          document.body.classList.remove('edit-mode');
          setEditButtonLabel(false);
          // Clean up transient state on exit.
          editor.moveSrc = null;
          editor.clipboard = null;
          hideDirPicker();
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              const el = cellEls[r] && cellEls[r][c];
              if (el) el.classList.remove('edit-source');
            }
          }
          render();
        }
      }

      // Sync the on-screen "Unsaved edits" pill to state.editorDirty.
      // Called after every editorDirty write so the badge tracks reality
      // even across the Done Editing → re-enter edit mode round-trip
      // (where the dirty flag intentionally persists).
      function syncDirtyBadge() {
        const badge = document.getElementById('unsaved-edits-badge');
        if (!badge) return;
        badge.classList.toggle('hidden', !state.editorDirty);
      }

      // ── Playtest mode ────────────────────────────────────────────────
      // The editor's missing-feature for a long time was a way to
      // iteratively test a draft without losing the edits. The flow:
      //
      //   1. In edit mode, click "Playtest" — captureCustomSnapshotFromState
      //      grabs the in-flight draft. We stash it on state._playtestSnapshot
      //      and exit edit mode.
      //   2. init() (in the level branch) sees _playtestSnapshot and
      //      applies it FIRST (before customLevels / built-in layouts),
      //      so the player plays the exact draft.
      //   3. Reset Level keeps re-applying the same snapshot because
      //      resetCurrentLevel() -> init() repeats step 2. The user can
      //      try the level as many times as they like.
      //   4. Click EDIT MODE (now labeled differently) to exit playtest:
      //      we clear _playtestSnapshot, reset the level so the editor
      //      sees a fresh board, then re-apply the snapshot so the user
      //      lands back in edit mode with their draft intact.
      function enterPlaytestMode() {
        if (!state.editMode) return;
        // Grab the in-flight draft from the live game state. Same snapshot
        // shape Save-Layout uses (env, items, IN, OUT, spiders, buttons…).
        const snap = captureCustomSnapshotFromState();
        state._playtestSnapshot = { level: state.level, snap };
        // Exit edit mode WITHOUT clearing editorDirty — the draft is the
        // dirty thing, and we want it to come back when the user returns.
        state.editMode = false;
        document.body.classList.remove('edit-mode');
        setEditButtonLabel(false);
        editor.moveSrc = null;
        editor.clipboard = null;
        hideDirPicker();
        // Re-init from the snapshot. resetCurrentLevel() routes through
        // init(), which now picks up state._playtestSnapshot first.
        if (typeof resetCurrentLevel === 'function') {
          resetCurrentLevel();
        }
        syncPlaytestBanner();
      }

      function exitPlaytestMode() {
        if (!state._playtestSnapshot) return false;
        const snap = state._playtestSnapshot.snap;
        state._playtestSnapshot = null;
        // Reset to wipe transient play state (spider positions, fog
        // reveal, animation timers). resetCurrentLevel -> init now sees
        // no _playtestSnapshot, so it would fall through to the built-in
        // layout — we re-apply the draft on top before re-entering
        // edit mode so the editor grid matches what the user was just
        // playing.
        if (typeof resetCurrentLevel === 'function') {
          resetCurrentLevel();
        }
        applyCustomLevel(snap);
        state.editMode = true;
        // The draft is still unsaved at this point — mark dirty so the
        // "Unsaved edits" pill re-appears and all the existing confirm
        // gates (level-jump, Reset, page-unload, Re-enter Edit Mode)
        // protect it correctly.
        state.editorDirty = true;
        syncDirtyBadge();
        document.body.classList.add('edit-mode');
        setEditButtonLabel(true);
        selectTool(editor.tool || 'erase');
        render();
        syncPlaytestBanner();
        return true;
      }

      // Toggle the playtest-mode banner ribbon on the level banner.
      // Keeps "EDIT MODE" relabeled to "Back to editor" while playtesting.
      function syncPlaytestBanner() {
        const banner = document.getElementById('playtest-banner');
        if (banner) {
          banner.classList.toggle('hidden', !state._playtestSnapshot);
        }
        const editBtn = document.getElementById('edit-btn');
        if (!editBtn) return;
        if (state._playtestSnapshot) {
          const title = editBtn.querySelector('.edit-mode-btn-title');
          const sub = editBtn.querySelector('.edit-mode-btn-sub');
          if (title) title.textContent = 'BACK TO EDITOR';
          if (sub) sub.textContent = 'Return to your draft';
          editBtn.classList.add('playtest-return');
        } else {
          editBtn.classList.remove('playtest-return');
          // setEditButtonLabel will be re-called by the next mode toggle.
        }
      }

      // Guard helper. If the user has unsaved editor edits, prompt before
      // running the supplied destructive action (level-jump, Reset Level,
      // Edit Mode toggle, page reload). Returns true if the action should
      // proceed (no dirty state, or user clicked OK), false to cancel.
      // Uses window.confirm — the lowest-friction "I really mean it"
      // gesture that works in every browser without extra DOM.
      function confirmDiscardEdits(actionLabel) {
        if (!state.editorDirty) return true;
        const msg = `You have unsaved edits. ${actionLabel} will discard them.\n\nClick OK to discard and continue, or Cancel to keep editing.`;
        const ok = window.confirm(msg);
        if (ok) {
          state.editorDirty = false;
          syncDirtyBadge();
        }
        return ok;
      }

      // Wire up the toolbar once at script load. The buttons are static
      // (set in the edit-banner markup) so a single delegated listener is
      // enough; tool switches just update editor.tool + active classes.
      (function wireEditToolbar() {
        const toolbar = document.getElementById('edit-tools');
        if (!toolbar) return;
        toolbar.addEventListener('click', (e) => {
          const btn = e.target.closest('.edit-tool');
          if (!btn || !toolbar.contains(btn)) return;
          selectTool(btn.dataset.tool);
        });
      })();

      // Hide the direction picker when the user clicks anywhere outside
      // it (and outside the board). Avoids the stale popover lingering
      // while the user paints elsewhere.
      document.addEventListener('mousedown', (e) => {
        const dp = document.getElementById('dir-picker');
        if (!dp || dp.classList.contains('hidden')) return;
        if (dp.contains(e.target)) return;
        // Clicks on the board itself are handled by onEditClick — let it
        // close / reopen the picker as needed.
        if (boardEl && boardEl.contains(e.target)) return;
        hideDirPicker();
      });

      // ── Custom levels (Save-layout tool) ─────────────────────────────────
      // Capture the current grid into a sparse snapshot suitable for
      // storage in state.customLevels[N] and localStorage. Cells that are
      // entirely empty (neutral env, no items, no spiders, no rocks /
      // keys / locks / wall / portal data) are skipped to keep the
      // payload small and human-readable.
      function captureCustomSnapshotFromState() {
        const cells = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const env = state.env[r][c] || 'neutral';
            const wallDirs = state.wallDirs[r][c];
            const portalDirs = state.portalDirs[r][c];
            const riverDirs = state.riverDirs[r][c];
            const spiderCount = state.spiders.filter((s) => s.alive && s.c === c && s.r === r).length;
            const weapon = !!state.weapons[r][c];
            const potion = !!state.potions[r][c];
            const cake = !!state.cakes[r][c];
            const key = !!state.keys[r][c];
            const lock = !!state.locks[r][c];
            const rock = !!state.rocks[r][c];
            const isEmpty = env === 'neutral' && !wallDirs && !portalDirs && !riverDirs
              && !weapon && !potion && !cake && !key && !lock && !rock
              && spiderCount === 0;
            if (isEmpty) continue;
            const entry = { c, r };
            if (env !== 'neutral') entry.env = env;
            if (wallDirs && wallDirs.length) entry.wallDirs = wallDirs.map((d) => ({ dc: d.dc, dr: d.dr }));
            if (portalDirs) entry.portalDirs = { dc: portalDirs.dc, dr: portalDirs.dr };
            if (riverDirs) entry.riverDirs = { dc: riverDirs.dc, dr: riverDirs.dr };
            if (weapon) entry.weapon = true;
            if (potion) entry.potion = true;
            if (cake) entry.cake = true;
            if (key) entry.key = true;
            if (lock) entry.lock = true;
            if (rock) entry.rock = true;
            if (spiderCount > 0) entry.spiderCount = spiderCount;
            cells.push(entry);
          }
        }
        return {
          inCell: { c: IN_CELL.c, r: IN_CELL.r },
          outCell: { c: OUT_CELL.c, r: OUT_CELL.r },
          cells,
          // Buttons live in a side list (not the per-cell layer grid),
          // so we serialize them separately. Each entry carries its own
          // (c, r) plus the wired target coords. The runtime _on flag is
          // not persisted — init/respawn rebaselines from board state.
          buttons: (state.buttons || []).map((b) => ({
            c: b.c, r: b.r,
            targets: (b.targets || []).map((t) => ({ c: t.c, r: t.r })),
          })),
          savedAt: Date.now(),
        };
      }

      // Apply a sparse snapshot to the current state. Called from init()
      // when a custom-level entry exists for state.level (taking priority
      // over the built-in level branches). Assumes the layer arrays
      // (state.env / state.wallDirs / etc.) were just reset to defaults
      // by init's preamble.
      function applyCustomLevel(snap) {
        if (!snap) return;
        if (snap.inCell && typeof snap.inCell.c === 'number') {
          IN_CELL.c = snap.inCell.c;
          IN_CELL.r = snap.inCell.r;
        }
        if (snap.outCell && typeof snap.outCell.c === 'number') {
          OUT_CELL.c = snap.outCell.c;
          OUT_CELL.r = snap.outCell.r;
        }
        state.spiders = [];
        // Buttons restore from the snapshot's side list (defaults to [] if
        // older snapshots predate the Button feature). _on is left false
        // — rebaselineButtons() runs after init() to sync from the board.
        state.buttons = (snap.buttons || []).map((b) => ({
          c: b.c, r: b.r,
          targets: (b.targets || []).map((t) => ({ c: t.c, r: t.r })),
          _on: false,
        }));
        for (const cell of (snap.cells || [])) {
          const { c, r } = cell;
          if (!inBounds(c, r)) continue;
          if (cell.env) state.env[r][c] = cell.env;
          if (cell.wallDirs) state.wallDirs[r][c] = cell.wallDirs.map((d) => ({ dc: d.dc, dr: d.dr }));
          if (cell.portalDirs) state.portalDirs[r][c] = { dc: cell.portalDirs.dc, dr: cell.portalDirs.dr };
          if (cell.riverDirs) state.riverDirs[r][c] = { dc: cell.riverDirs.dc, dr: cell.riverDirs.dr };
          if (cell.weapon) state.weapons[r][c] = true;
          if (cell.potion) state.potions[r][c] = true;
          if (cell.cake) state.cakes[r][c] = true;
          if (cell.key) state.keys[r][c] = true;
          if (cell.lock) state.locks[r][c] = true;
          if (cell.rock) state.rocks[r][c] = true;
          const sc = cell.spiderCount || 0;
          for (let i = 0; i < sc; i++) {
            state.spiders.push({
              c, r,
              alive: true,
              isBaby: false,
              babyTurnsLeft: 0,
              justBorn: false,
            });
          }
        }
      }

      // Persist customLevels to localStorage. Best-effort — browsers in
      // private mode may throw on write; we just swallow and continue.
      function persistCustomLevels() {
        try {
          localStorage.setItem(STORAGE_KEY_CUSTOM_LEVELS, JSON.stringify(state.customLevels || {}));
        } catch (e) { /* private-mode / quota — ignore */ }
      }

      // Read customLevels back from localStorage at script startup.
      // Quietly resets to {} on parse error.
      function loadCustomLevelsFromStorage() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_LEVELS);
          if (!raw) return;
          const obj = JSON.parse(raw);
          if (obj && typeof obj === 'object') {
            state.customLevels = obj;
            // Bump MAX_LEVEL to one past the highest saved level so the
            // jump-pad shows a button for it.
            for (const k of Object.keys(state.customLevels)) {
              const n = Number(k);
              if (Number.isFinite(n) && n + 1 > MAX_LEVEL) {
                MAX_LEVEL = n + 1;
              }
            }
          }
        } catch (e) { state.customLevels = {}; }
      }
      loadCustomLevelsFromStorage();

      // One-time migration: purge stale saves of "Ordered Escape" (UI
      // Level 12 → key 11). The OE built-in layout has been completely
      // re-authored (open floor, two buttons, three portals, one lock —
      // no walls / lava / TnT / trees / rivers / knights / extra rocks)
      // so any pre-rewrite save will shadow the new layout and make
      // the level look broken. Bumping the tag re-runs the purge for
      // every browser that hasn't seen v4 yet. Future schema changes
      // can bump the tag again.
      //
      // v4 (2026-05-12): added free rock at (5, 1), south-wall gate at
      // (0, 5), Green Portal A at (0, 6), and converted (8, 9) Yellow→
      // Green. Without this bump, browsers cached a v3 snapshot that
      // pinned rocks behind walls and broke pushability.
      (function migrateStaleOrderedEscapeSave() {
        const TAG = 'spiders3-migration-v4-ordered-escape-green-portal';
        try {
          if (localStorage.getItem(TAG) === '1') return;
          if (state.customLevels && state.customLevels[11]) {
            delete state.customLevels[11];
            try {
              localStorage.setItem(STORAGE_KEY_CUSTOM_LEVELS, JSON.stringify(state.customLevels));
            } catch (e) { /* quota / private mode — ignore */ }
          }
          localStorage.setItem(TAG, '1');
        } catch (e) { /* private mode — ignore */ }
      })();

      // Sandbox-materialize a target level into a fresh layer snapshot
      // without disturbing the live game state. Used by the save-layout
      // preview to show what the target level currently looks like
      // (whether built-in or custom).
      //
      // Captures every layer the editor cares about, sets state.level +
      // state._sandboxLevel so init() short-circuits before player setup
      // / render, then restores the snapshot when done. Returns the
      // rebuilt layers as a plain object the mini-grid can render from.
      function materializePreview(targetLevel) {
        const before = {
          env: state.env,
          weapons: state.weapons,
          potions: state.potions,
          cakes: state.cakes,
          keys: state.keys,
          locks: state.locks,
          wallDirs: state.wallDirs,
          portalDirs: state.portalDirs,
          riverDirs: state.riverDirs,
          rocks: state.rocks,
          spiders: state.spiders,
          spidersInitial: state.spidersInitial,
          rocksInitial: state.rocksInitial,
          envInitial: state.envInitial,
          weaponsInitial: state.weaponsInitial,
          potionsInitial: state.potionsInitial,
          cakesInitial: state.cakesInitial,
          // Buttons live in a side list (not a per-cell grid) so init()
          // wipes them to []. Without this, opening the Save Layout
          // modal — which calls materializePreview() — silently dropped
          // every wired button before the user could hit "Print to
          // level". Deep-clone so further edits to state.buttons during
          // materialize don't poison the snapshot.
          buttons: (state.buttons || []).map((b) => ({
            c: b.c, r: b.r,
            targets: (b.targets || []).map((t) => ({ c: t.c, r: t.r })),
            _on: !!b._on,
          })),
          pendingFx: state.pendingFx,
          pendingPath: state.pendingPath,
          animating: state.animating,
          inC: IN_CELL.c, inR: IN_CELL.r,
          outC: OUT_CELL.c, outR: OUT_CELL.r,
          level: state.level,
        };
        try {
          state.level = targetLevel;
          state._sandboxLevel = true;
          init();
        } finally {
          state._sandboxLevel = false;
        }
        // Snapshot the materialized layers (deep enough for read-only render).
        const layers = {
          env: state.env.map((row) => row.slice()),
          weapons: state.weapons.map((row) => row.slice()),
          potions: state.potions.map((row) => row.slice()),
          cakes: state.cakes.map((row) => row.slice()),
          keys: state.keys.map((row) => row.slice()),
          locks: state.locks.map((row) => row.slice()),
          wallDirs: state.wallDirs.map((row) => row.map((d) => d ? d.map((x) => ({ ...x })) : null)),
          portalDirs: state.portalDirs.map((row) => row.map((d) => d ? { ...d } : null)),
          riverDirs: state.riverDirs.map((row) => row.map((d) => d ? { ...d } : null)),
          rocks: state.rocks.map((row) => row.slice()),
          spiders: state.spiders.map((s) => ({ c: s.c, r: s.r })),
          inCell: { c: IN_CELL.c, r: IN_CELL.r },
          outCell: { c: OUT_CELL.c, r: OUT_CELL.r },
        };
        // Restore everything we touched. We're outside the live game
        // loop here, so re-entry via render() (already short-circuited)
        // is unnecessary.
        state.env = before.env;
        state.weapons = before.weapons;
        state.potions = before.potions;
        state.cakes = before.cakes;
        state.keys = before.keys;
        state.locks = before.locks;
        state.wallDirs = before.wallDirs;
        state.portalDirs = before.portalDirs;
        state.riverDirs = before.riverDirs;
        state.rocks = before.rocks;
        state.spiders = before.spiders;
        state.spidersInitial = before.spidersInitial;
        state.rocksInitial = before.rocksInitial;
        state.envInitial = before.envInitial;
        state.weaponsInitial = before.weaponsInitial;
        state.potionsInitial = before.potionsInitial;
        state.cakesInitial = before.cakesInitial;
        state.buttons = before.buttons;
        state.pendingFx = before.pendingFx;
        state.pendingPath = before.pendingPath;
        state.animating = before.animating;
        IN_CELL.c = before.inC; IN_CELL.r = before.inR;
        OUT_CELL.c = before.outC; OUT_CELL.r = before.outR;
        state.level = before.level;
        return layers;
      }

      // True if the materialized layers contain no game content beyond
      // default IN at (0,0) and OUT at (9,9). Used to decide whether the
      // save-layout modal needs an "are you sure" gate.
      function previewIsEmpty(layers) {
        if (!layers) return true;
        if (layers.inCell.c !== 0 || layers.inCell.r !== 0) return false;
        if (layers.outCell.c !== DEFAULT_OUT_CELL.c || layers.outCell.r !== DEFAULT_OUT_CELL.r) return false;
        if (layers.spiders.length > 0) return false;
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (layers.env[r][c] && layers.env[r][c] !== 'neutral') return false;
            if (layers.weapons[r][c]) return false;
            if (layers.potions[r][c]) return false;
            if (layers.cakes[r][c]) return false;
            if (layers.keys[r][c]) return false;
            if (layers.locks[r][c]) return false;
            if (layers.rocks[r][c]) return false;
            if (layers.wallDirs[r][c]) return false;
            if (layers.portalDirs[r][c]) return false;
            if (layers.riverDirs && layers.riverDirs[r][c]) return false;
          }
        }
        return true;
      }

      // Render a 10×10 mini-grid of the preview into the modal. Each cell
      // gets a class for its env background and (optionally) a single
      // glyph for the most prominent content (spider > rock > lock > key
      // > weapon > potion > cake). IN/OUT get colored backgrounds.
      function renderMiniGrid(container, layers) {
        if (!container) return;
        container.innerHTML = '';
        const spiderSet = new Set();
        for (const s of layers.spiders) spiderSet.add(`${s.c},${s.r}`);
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const div = document.createElement('div');
            div.className = 'mc';
            const env = layers.env[r][c];
            if (env && env !== 'neutral') {
              div.classList.add('env-' + env);
            } else if (layers.wallDirs[r][c]) {
              // Walls placed via wallDirs without an env flag (rare — Level 0
              // hidden corridor uses this trick) — render as a faint wall.
              div.classList.add('env-wall');
            }
            if (c === layers.inCell.c && r === layers.inCell.r) {
              div.classList.add('in');
              div.textContent = 'IN';
            } else if (c === layers.outCell.c && r === layers.outCell.r) {
              div.classList.add('out');
              div.textContent = 'OUT';
            } else if (spiderSet.has(`${c},${r}`)) {
              div.textContent = state.spiderFree ? '🪱' : '🕷';
            } else if (layers.rocks[r][c]) {
              div.textContent = '🪨';
            } else if (layers.locks[r][c]) {
              div.textContent = '🔒';
            } else if (layers.keys[r][c]) {
              div.textContent = '🔑';
            } else if (layers.weapons[r][c]) {
              div.textContent = '🗡';
            } else if (layers.potions[r][c]) {
              div.textContent = '🧪';
            } else if (layers.cakes[r][c]) {
              div.textContent = '🍰';
            }
            container.appendChild(div);
          }
        }
      }

      // Refresh the modal preview from the current target-level input.
      // Called whenever the input changes or the modal opens. The input
      // is 1-indexed (matches the in-game UI); convert to a 0-indexed
      // slot at the boundary.
      function refreshSaveLayoutPreview() {
        const input = document.getElementById('save-layout-level');
        const meta = document.getElementById('save-layout-level-meta');
        const status = document.getElementById('save-layout-status');
        const grid = document.getElementById('save-layout-mini-grid');
        const previewMeta = document.getElementById('save-layout-preview-meta');
        const confirmBtn = document.getElementById('save-layout-confirm');
        const deleteBtn = document.getElementById('save-layout-delete');
        const nameInput = document.getElementById('save-layout-name');
        if (!input || !meta || !status || !grid || !previewMeta || !confirmBtn) return;
        const raw = parseInt(input.value, 10);
        const target = Number.isFinite(raw) && raw >= 1 ? raw - 1 : 0;
        const displayLevel = target + 1;
        if (displayLevel !== raw) input.value = String(displayLevel);

        // Tag indicating built-in vs custom vs new.
        const hasCustom = !!(state.customLevels && state.customLevels[target]);
        const isNewSlot = target >= MAX_LEVEL;
        if (hasCustom) {
          meta.textContent = '(custom)';
          meta.style.color = '#fde047';
        } else if (isNewSlot) {
          meta.textContent = '(new — beyond current max)';
          meta.style.color = '#86efac';
        } else {
          meta.textContent = '(built-in)';
          meta.style.color = '#94a3b8';
        }

        // Auto-fill the name input. If the user has already typed a
        // custom name during this open of the modal, keep it; otherwise
        // load the saved snapshot name (or built-in name) for context.
        if (nameInput && !nameInput.dataset.userEdited) {
          const saved = hasCustom && state.customLevels[target] && state.customLevels[target].name;
          const builtin = LEVEL_NAMES[target] || '';
          nameInput.value = saved || (isNewSlot ? '' : builtin);
        }

        // Compute the preview layers. For a "new slot" beyond MAX_LEVEL
        // there's nothing to materialize, so we just render an empty grid.
        let layers;
        if (isNewSlot && !hasCustom) {
          layers = {
            env: Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 'neutral')),
            weapons: Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => false)),
            potions: Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => false)),
            cakes: Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => false)),
            keys: Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => false)),
            locks: Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => false)),
            wallDirs: Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null)),
            portalDirs: Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null)),
            rocks: Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => false)),
            spiders: [],
            inCell: { c: 0, r: 0 },
            outCell: { c: DEFAULT_OUT_CELL.c, r: DEFAULT_OUT_CELL.r },
          };
        } else {
          layers = materializePreview(target);
        }
        renderMiniGrid(grid, layers);

        const empty = previewIsEmpty(layers);
        // A slot is "randomized" only when LEVEL_ORDER has no entry for
        // it AND there's no saved custom snapshot. All built-in slots
        // (0..LEVEL_ORDER.length-1) materialize deterministically.
        const isRandom = !hasCustom && !getLayout(target);
        if (empty) {
          status.textContent = isNewSlot
            ? `Level ${displayLevel} is a new slot — saving will create it.`
            : `Level ${displayLevel} is empty — safe to save.`;
          status.className = 'save-layout-status ok';
          confirmBtn.textContent = 'Print to level';
        } else {
          status.textContent = hasCustom
            ? `Level ${displayLevel} already has a custom layout. This will overwrite it.`
            : `Level ${displayLevel} has built-in content. Overwriting will replace it for this game.`;
          status.className = 'save-layout-status warn';
          confirmBtn.textContent = 'Print to level';
        }
        // The "randomized" note only applies to existing built-in slots
        // that don't have a LEVEL_ORDER entry — i.e. slots where init()
        // would fall through to the random pipeline. New slots beyond
        // MAX_LEVEL are also `!getLayout()` but they're not randomized;
        // they're just empty, so suppress the note for those.
        if (isRandom && !hasCustom && !isNewSlot) {
          previewMeta.textContent = 'Note: Level ' + displayLevel + ' is randomized — preview shows one sample layout.';
        } else {
          previewMeta.textContent = '';
        }
        // Show the Delete button only when a custom layout exists.
        if (deleteBtn) deleteBtn.style.display = hasCustom ? '' : 'none';
        // The Export button is now always visible while the modal is
        // open. The label adapts:
        //   • hasCustom → "Copy JSON" (copies the saved snapshot for
        //     this slot).
        //   • else if any other slot has a save → "Copy all JSON"
        //     (copies the whole customLevels bag).
        //   • else → "Copy current layout" (captures a fresh snapshot
        //     from the live editor grid, even if nothing has been
        //     saved yet).
        const exportBtn = document.getElementById('save-layout-export');
        if (exportBtn) {
          const anyCustom = state.customLevels &&
            Object.keys(state.customLevels).length > 0;
          exportBtn.style.display = '';
          if (hasCustom) exportBtn.textContent = 'Copy JSON';
          else if (anyCustom) exportBtn.textContent = 'Copy all JSON';
          else exportBtn.textContent = 'Copy current layout';
        }
      }

      function openSaveLayoutModal() {
        const overlay = document.getElementById('save-layout-overlay');
        const input = document.getElementById('save-layout-level');
        const nameInput = document.getElementById('save-layout-name');
        if (!overlay || !input) return;
        // Default the target level to the current state.level (most
        // common case: the user just authored a layout for this level
        // and wants to save it). Display as 1-indexed.
        input.value = String((state.level || 0) + 1);
        // Clear the "user edited" flag so refreshSaveLayoutPreview
        // is allowed to re-prefill the name from the saved snapshot or
        // built-in name on open.
        if (nameInput) {
          delete nameInput.dataset.userEdited;
          nameInput.value = '';
        }
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        refreshSaveLayoutPreview();
        // Defer focus until the dialog is on-screen so the cursor lands
        // in the level input where the user is most likely to type.
        setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 0);
      }

      function closeSaveLayoutModal() {
        const overlay = document.getElementById('save-layout-overlay');
        if (!overlay) return;
        overlay.classList.add('hidden');
        overlay.setAttribute('aria-hidden', 'true');
      }

      // Commit the current grid as the target level. Bumps MAX_LEVEL,
      // re-renders the jump pad, persists, and updates the on-screen
      // status / level title without leaving edit mode.
      function confirmSaveLayout() {
        const input = document.getElementById('save-layout-level');
        const nameInput = document.getElementById('save-layout-name');
        if (!input) return;
        const raw = parseInt(input.value, 10);
        const target = Number.isFinite(raw) && raw >= 1 ? raw - 1 : 0;
        const snap = captureCustomSnapshotFromState();
        // Attach the player's chosen level name (trimmed). Falls back
        // to any pre-existing custom name, then the built-in name, then
        // empty so the level slot keeps a friendly label.
        const typedName = nameInput ? String(nameInput.value || '').trim() : '';
        const prevName = (state.customLevels[target] && state.customLevels[target].name) || '';
        const builtin = LEVEL_NAMES[target] || '';
        const finalName = typedName || prevName || builtin || '';
        if (finalName) snap.name = finalName;
        state.customLevels[target] = snap;
        if (target + 1 > MAX_LEVEL) {
          MAX_LEVEL = target + 1;
          rebuildLevelJumpButtons();
        } else {
          // Rebuild even when MAX_LEVEL didn't grow so the .custom
          // marker shows up on the just-saved button.
          rebuildLevelJumpButtons();
        }
        persistCustomLevels();
        // Edits are now persisted — clear the dirty flag so the
        // discard-confirm guards stop prompting until the next mutation.
        state.editorDirty = false;
        syncDirtyBadge();
        closeSaveLayoutModal();
        const label = finalName ? `"${finalName}" (Level ${target + 1})` : `Level ${target + 1}`;
        setEditHint(`Saved current layout to ${label}.`);
        render();
      }

      // Remove a custom layout for the target level. The level reverts
      // to its built-in branch (or the random pipeline) on the next
      // init(). Does NOT shrink MAX_LEVEL — the user may have other
      // layouts still pinned at higher numbers.
      function deleteCustomLayout() {
        const input = document.getElementById('save-layout-level');
        if (!input) return;
        const raw = parseInt(input.value, 10);
        const target = Number.isFinite(raw) && raw >= 1 ? raw - 1 : 0;
        if (!state.customLevels[target]) return;
        delete state.customLevels[target];
        persistCustomLevels();
        // Recompute MAX_LEVEL: it's max(12, highestCustomLevel + 1).
        let highest = 11; // default 12 levels (0..11)
        for (const k of Object.keys(state.customLevels)) {
          const n = Number(k);
          if (Number.isFinite(n) && n > highest) highest = n;
        }
        const newMax = highest + 1;
        if (newMax !== MAX_LEVEL) {
          MAX_LEVEL = newMax;
          rebuildLevelJumpButtons();
        }
        refreshSaveLayoutPreview();
        setEditHint(`Deleted custom layout for Level ${target + 1}.`);
        render();
      }

      // Copy the target slot's saved JSON to the clipboard. Falls back
      // to the full state.customLevels bag if the target slot has no
      // saved snapshot. Uses navigator.clipboard.writeText when
      // available (HTTPS / localhost), otherwise falls back to a
      // hidden-textarea + execCommand('copy') trick for older /
      // non-secure contexts. Status is reported via the modal's status
      // line which auto-clears on the next preview refresh.
      function exportCustomLayoutToClipboard() {
        const input = document.getElementById('save-layout-level');
        const status = document.getElementById('save-layout-status');
        if (!input) return;
        const raw = parseInt(input.value, 10);
        const target = Number.isFinite(raw) && raw >= 1 ? raw - 1 : 0;
        const slot = state.customLevels && state.customLevels[target];
        const anyCustom = state.customLevels &&
          Object.keys(state.customLevels).length > 0;
        // Decide what to copy:
        //   • Target slot has a save → that saved snapshot.
        //   • No save in target, but other slots exist → whole bag.
        //   • Nothing saved anywhere → capture the live editor grid.
        let payload;
        let label;
        if (slot) {
          payload = slot;
          label = `Level ${target + 1} layout`;
        } else if (anyCustom) {
          payload = state.customLevels || {};
          label = 'all saved layouts';
        } else {
          payload = captureCustomSnapshotFromState();
          label = 'current layout';
        }
        const text = JSON.stringify(payload, null, 2);
        const flash = (msg, ok) => {
          if (!status) return;
          status.textContent = msg;
          status.className = 'save-layout-status ' + (ok ? 'ok' : 'warn');
        };
        const onSuccess = () => flash(`Copied ${label} to clipboard.`, true);
        const onFailure = () => {
          // Last-ditch fallback: stash on a textarea + execCommand. This
          // works on file:// or HTTP origins where the async clipboard
          // API is unavailable.
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            if (ok) onSuccess();
            else flash('Copy failed — clipboard not available.', false);
          } catch (e) {
            flash('Copy failed — clipboard not available.', false);
          }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(onSuccess, onFailure);
        } else {
          onFailure();
        }
      }

      // Wire up the modal once at script load.
      (function wireSaveLayoutModal() {
        const overlay = document.getElementById('save-layout-overlay');
        const input = document.getElementById('save-layout-level');
        const nameInput = document.getElementById('save-layout-name');
        const newSlotBtn = document.getElementById('save-layout-new-slot');
        // Top-right X close button (replaces the old bottom Cancel).
        const closeBtn = document.getElementById('save-layout-close');
        const confirmBtn = document.getElementById('save-layout-confirm');
        const deleteBtn = document.getElementById('save-layout-delete');
        const exportBtn = document.getElementById('save-layout-export');
        if (!overlay || !input || !closeBtn || !confirmBtn) return;
        input.addEventListener('input', refreshSaveLayoutPreview);
        input.addEventListener('change', refreshSaveLayoutPreview);
        closeBtn.addEventListener('click', closeSaveLayoutModal);
        confirmBtn.addEventListener('click', confirmSaveLayout);
        if (deleteBtn) deleteBtn.addEventListener('click', deleteCustomLayout);
        if (exportBtn) exportBtn.addEventListener('click', exportCustomLayoutToClipboard);
        if (newSlotBtn) {
          // "+ New level": jump the target to the next slot at the end
          // of the level list (= current MAX_LEVEL). Lets the user save
          // the current grid as a brand-new level without doing the
          // mental math of "what's the highest level number again?".
          newSlotBtn.addEventListener('click', () => {
            input.value = String(MAX_LEVEL);
            if (nameInput) {
              delete nameInput.dataset.userEdited;
              nameInput.value = '';
            }
            refreshSaveLayoutPreview();
            if (nameInput) {
              try { nameInput.focus(); nameInput.select(); } catch (e) {}
            }
          });
        }
        if (nameInput) {
          // Track that the user has typed a name so the preview refresh
          // doesn't clobber it when they change the target level.
          nameInput.addEventListener('input', () => {
            nameInput.dataset.userEdited = '1';
          });
        }
        // Click on the dim backdrop (but not the dialog) closes the modal.
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) closeSaveLayoutModal();
        });
        // Escape closes; Enter on either input commits.
        document.addEventListener('keydown', (e) => {
          if (overlay.classList.contains('hidden')) return;
          if (e.key === 'Escape') { e.preventDefault(); closeSaveLayoutModal(); }
          else if (e.key === 'Enter' && (document.activeElement === input || document.activeElement === nameInput)) {
            e.preventDefault();
            confirmSaveLayout();
          }
        });
      })();

      // Collapsible Rules card. Defaults to hidden; remembers the user's
      // last choice in localStorage so the panel state persists across
      // reloads.
      (function wireRulesToggle() {
        const btn = document.getElementById('rules-toggle');
        const list = document.getElementById('rules-list');
        if (!btn || !list) return;
        const KEY = 'spiders3-rules-open';
        let open = false;
        try { open = localStorage.getItem(KEY) === '1'; } catch (e) {}
        const apply = () => {
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          if (open) list.removeAttribute('hidden');
          else list.setAttribute('hidden', '');
        };
        apply();
        btn.addEventListener('click', () => {
          open = !open;
          apply();
          try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) {}
        });
      })();

      // Collapsible Hazards / Items / Effects card. Unlike the Rules
      // card, this one intentionally does NOT persist its state: every
      // page load starts collapsed so first-time players aren't hit
      // with a wall of glyphs they haven't met yet — they can expand
      // it the first time they bump into something unfamiliar.
      (function wireHazardsToggle() {
        const btn = document.getElementById('hazards-toggle');
        const list = document.getElementById('hazards-list');
        if (!btn || !list) return;
        let open = false;
        const apply = () => {
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          if (open) list.removeAttribute('hidden');
          else list.setAttribute('hidden', '');
        };
        apply();
        btn.addEventListener('click', () => {
          open = !open;
          apply();
        });
      })();

      // ── Render ───────────────────────────────────────────────────────────
      function render(opts = {}) {
        const hideActiveIdx = (typeof opts.hideActiveIdx === 'number') ? opts.hideActiveIdx : -1;
        // Sync the body class with spider-free mode so the title's red
        // strike + green "Worms III" reveal stays consistent with state.
        document.body.classList.toggle('spider-free-mode', !!state.spiderFree);
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const el = cellEls[r][c];
            el.classList.remove(
              'legal', 'p2',
              'in', 'out',
              'env-slide', 'env-river', 'env-knight', 'env-green-knight', 'env-lava', 'env-tnt', 'env-wall', 'env-portal', 'env-portal-y', 'env-portal-b', 'env-portal-r', 'env-boulder', 'env-button', 'env-tree',
              'button-on', 'button-wire-source', 'button-wire-target', 'button-wired',
              'river-up', 'river-down', 'river-left', 'river-right'
            );
            // Remove any previously rendered glyphs / tokens / spiders / weapons / wall bars / portal bars / rocks / cakes / IN-OUT labels.
            // Labels are recreated below so OUT can move between cells
            // (Level 5 hides OUT under a random rock).
            el.querySelectorAll('.token, .env-glyph, .spider, .weapon, .wall-bar, .portal-bar, .river-arrow, .rock, .cake, .key-item, .lock-cage, .label')
              .forEach((n) => n.remove());

            // Sync IN / OUT marking with the current OUT_CELL coords.
            // buildBoard() seeds these once at startup, but OUT_CELL can
            // move (Level 5), so we reconcile every frame here.
            if (isInCell(c, r)) {
              el.classList.add('in');
              const lab = document.createElement('span');
              lab.className = 'label';
              lab.textContent = 'in';
              el.appendChild(lab);
            }
            if (isOutCell(c, r)) {
              el.classList.add('out');
              const lab = document.createElement('span');
              lab.className = 'label';
              lab.textContent = 'out';
              el.appendChild(lab);
            }

            // Paint env (skip IN/OUT)
            const envKey = state.env[r][c];
            // Boulder slice offsets: each boulder cell shows its (c, r)
            // slice of the one-board-wide stone composition so adjacent
            // boulders flow into a single continuous rock. (The chunky
            // polygon silhouette via --b-clip was removed — the CSS
            // falls back to clip-path: none, leaving rectangular tiles
            // that still fuse seamlessly thanks to the shared gradient.)
            // We always refresh these on every cell so toggling boulder
            // on/off via the Edit cells tool stays consistent.
            if (envKey === 'boulder') {
              el.style.setProperty('--bx', `${(c / 9) * 100}%`);
              el.style.setProperty('--by', `${(r / 9) * 100}%`);
            } else {
              el.style.removeProperty('--bx');
              el.style.removeProperty('--by');
            }
            if (!isInOrOut(c, r) && envKey && envKey !== 'neutral') {
              // Effective env for portal cells respects any pressed
              // button that's currently transforming this red portal
              // into a yellow one — render that visual override here so
              // the player sees the change in real time.
              const renderEnvKey = isPortalKey(envKey) ? effectivePortalKey(c, r) : envKey;
              el.classList.add(`env-${renderEnvKey}`);
              // Walls render one .wall-bar span per blocked direction so 1–4 sides can stack.
              if (envKey === 'wall') {
                const wds = state.wallDirs[r][c];
                if (Array.isArray(wds)) {
                  for (const wd of wds) {
                    const bar = document.createElement('span');
                    bar.className = 'wall-bar';
                    if (wd.dr === -1)      bar.classList.add('up');
                    else if (wd.dr === 1)  bar.classList.add('down');
                    else if (wd.dc === -1) bar.classList.add('left');
                    else if (wd.dc === 1)  bar.classList.add('right');
                    el.appendChild(bar);
                  }
                }
              }
              // Portals (purple, yellow, blue, red, or green) render a single
              // dashed .portal-bar on the bar side. The .yellow / .blue / .red
              // / .green modifier swaps the bar palette; purple is the default.
              // A red portal currently held by a pressed button renders
              // with the yellow palette (matching its temporary identity).
              if (isPortalKey(envKey)) {
                const pd = state.portalDirs[r][c];
                if (pd) {
                  const bar = document.createElement('span');
                  bar.className = 'portal-bar';
                  if (renderEnvKey === 'portal-y')      bar.classList.add('yellow');
                  else if (renderEnvKey === 'portal-b') bar.classList.add('blue');
                  else if (renderEnvKey === 'portal-r') bar.classList.add('red');
                  else if (renderEnvKey === 'portal-g') bar.classList.add('green');
                  if (pd.dr === -1)      bar.classList.add('up');
                  else if (pd.dr === 1)  bar.classList.add('down');
                  else if (pd.dc === -1) bar.classList.add('left');
                  else if (pd.dc === 1)  bar.classList.add('right');
                  el.appendChild(bar);
                }
              }
              // River cells get a direction class (river-up/down/left/right)
              // for the animated water gradient, plus a big arrow overlay
              // so the flow direction is unambiguous.
              if (envKey === 'river') {
                const rd = state.riverDirs[r] && state.riverDirs[r][c];
                if (rd) {
                  let arrow = '';
                  if (rd.dr === -1)      { el.classList.add('river-up');    arrow = '↑'; }
                  else if (rd.dr === 1)  { el.classList.add('river-down');  arrow = '↓'; }
                  else if (rd.dc === -1) { el.classList.add('river-left');  arrow = '←'; }
                  else if (rd.dc === 1)  { el.classList.add('river-right'); arrow = '→'; }
                  if (arrow) {
                    const ar = document.createElement('span');
                    ar.className = 'river-arrow';
                    ar.textContent = arrow;
                    el.appendChild(ar);
                  }
                }
              }
              const def = ENV_TYPES[envKey];
              if (def.glyph) {
                const g = document.createElement('span');
                g.className = 'env-glyph';
                g.innerHTML = def.glyph;
                el.appendChild(g);
              }
            }

            // Rock layer (state.rocks). Drawn on top of the env so a rock
            // sitting on a slide/portal/sandlot shows the rock prominently
            // while the env art is still visible behind it. Rocks render
            // as a real DOM child rather than a pseudo-element so a single
            // cell can carry both env art (::before) and a rock at once.
            //
            // Visual indicators for interactive env cells:
            //   • on-button       → red outer glow, signaling the button
            //     is currently being held down by the rock.
            //   • on-portal-<key> → rock shrinks toward the center so the
            //     underlying portal art (stripes + dashed exit bar) still
            //     reads. The bar tells the player which way another shove
            //     teleports the rock. The class also carries the portal
            //     color so the glow tints to match.
            if (state.rocks[r] && state.rocks[r][c]) {
              const rk = document.createElement('span');
              rk.className = 'rock';
              const envHere = state.env[r] && state.env[r][c];
              if (envHere === 'button') {
                rk.classList.add('on-button');
              } else if (isPortalKey(envHere)) {
                rk.classList.add('on-portal');
                rk.classList.add(`on-${envHere}`);
              }
              el.appendChild(rk);
            }

            // Treasure chest pickup. The chest may contain either a Spider
            // Knife (state.weapons) or an Invisibility Potion (state.potions).
            // They are deliberately rendered identically — the player only
            // learns which they got at pickup time.
            if (state.weapons[r][c] || state.potions[r][c]) {
              const w = document.createElement('span');
              w.className = 'weapon';
              w.innerHTML = `
                <svg viewBox="0 0 32 28" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <!-- Chest body -->
                  <rect x="3" y="12" width="26" height="14" rx="2" fill="#7c4a1e" stroke="#3b1f08" stroke-width="1.2"/>
                  <!-- Lid -->
                  <path d="M3,12 Q16,2 29,12 Z" fill="#a06228" stroke="#3b1f08" stroke-width="1.2"/>
                  <!-- Brass bands -->
                  <rect x="3" y="11" width="26" height="2.2" fill="#fde047" stroke="#a16207" stroke-width="0.6"/>
                  <rect x="3" y="22" width="26" height="2" fill="#fde047" stroke="#a16207" stroke-width="0.5"/>
                  <!-- Lock -->
                  <rect x="14" y="14" width="4" height="5" rx="0.5" fill="#fde047" stroke="#a16207" stroke-width="0.5"/>
                  <circle cx="16" cy="16.4" r="0.7" fill="#3b1f08"/>
                </svg>
              `;
              el.appendChild(w);
            }
            // Cake pickup. Rendered as an emoji on top of the cell.
            if (state.cakes[r] && state.cakes[r][c]) {
              const ck = document.createElement('span');
              ck.className = 'cake';
              ck.innerHTML = '&#x1F370;';
              ck.setAttribute('aria-label', 'Cake');
              el.appendChild(ck);
            }
            // Key pickup. Rendered as a golden key emoji on the cell.
            if (state.keys[r] && state.keys[r][c]) {
              const ky = document.createElement('span');
              ky.className = 'key-item';
              ky.innerHTML = '&#x1F511;';
              ky.setAttribute('aria-label', 'Key');
              el.appendChild(ky);
            }
            // Lock overlay. The cage is drawn LAST so it visibly sits on
            // top of the env art, items, and even the OUT marker, while
            // leaving the underlying state (env type, weapons/potions/keys/
            // cakes booleans, OUT_CELL coords) untouched. The descend/
            // ascend animation flag is consumed from state.pendingFx —
            // any 'lock-descend' / 'lock-ascend' fx for this cell on the
            // current render adds the corresponding class.
            if (state.locks[r] && state.locks[r][c]) {
              const cage = document.createElement('div');
              cage.className = 'lock-cage';
              for (let i = 1; i <= 4; i++) {
                const bar = document.createElement('span');
                bar.className = 'lock-bar b' + i;
                cage.appendChild(bar);
              }
              const frame = document.createElement('span');
              frame.className = 'lock-frame';
              cage.appendChild(frame);
              const glyph = document.createElement('span');
              glyph.className = 'lock-glyph';
              glyph.innerHTML = '&#x1F512;';
              cage.appendChild(glyph);
              const descendFx = state.pendingFx.find((fx) => fx.type === 'lock-descend' && fx.c === c && fx.r === r);
              if (descendFx) cage.classList.add('descend');
              // Button-driven held-open state: if any pressed button is
              // wired to this lock, the cage is rendered with its bars
              // retracted. A one-shot 'lock-lift' fx (queued by
              // processButtonPresses on the OFF\u2192ON transition) animates
              // the bars sliding up on this render; subsequent renders
              // just keep them parked at the lifted position via the
              // .held-open static rule.
              const liftFx = state.pendingFx.find((fx) => fx.type === 'lock-lift' && fx.c === c && fx.r === r);
              const dropFx = state.pendingFx.find((fx) => fx.type === 'lock-drop' && fx.c === c && fx.r === r);
              if (isLockHeldOpenByButton(c, r)) cage.classList.add('held-open');
              if (liftFx) cage.classList.add('lift');
              if (dropFx) cage.classList.add('drop');
              el.appendChild(cage);
            } else {
              // Cell is no longer locked, but a 'lock-ascend' fx may still
              // be queued from this turn — play the retracting cage on top
              // of the now-clear cell so the animation is visible before
              // the next render clears the fx queue.
              const ascendFx = state.pendingFx.find((fx) => fx.type === 'lock-ascend' && fx.c === c && fx.r === r);
              if (ascendFx) {
                const cage = document.createElement('div');
                cage.className = 'lock-cage ascend';
                for (let i = 1; i <= 4; i++) {
                  const bar = document.createElement('span');
                  bar.className = 'lock-bar b' + i;
                  cage.appendChild(bar);
                }
                const frame = document.createElement('span');
                frame.className = 'lock-frame';
                cage.appendChild(frame);
                const glyph = document.createElement('span');
                glyph.className = 'lock-glyph';
                glyph.innerHTML = '&#x1F512;';
                cage.appendChild(glyph);
                cage.addEventListener('animationend', () => cage.remove());
                el.appendChild(cage);
              }
            }
          }
        }

        // Button state pass (after the per-cell env render). Paint the
        // .button-on modifier on cells where a button is currently pressed
        // (player or rock occupies the cell), and \u2014 only while in edit mode
        // \u2014 highlight wired targets and the currently-being-wired button.
        // Done in a second pass so wire highlights overlap the env paint
        // and we don't have to thread button state into the cell loop.
        if (state.buttons && state.buttons.length) {
          for (const b of state.buttons) {
            if (!inBounds(b.c, b.r)) continue;
            const el = cellEls[b.r] && cellEls[b.r][b.c];
            if (!el) continue;
            if (isButtonPressed(b.c, b.r)) el.classList.add('button-on');
            if (state.editMode) {
              // Persistent green-check badge on any button with >= 1 wired
              // target so the designer can spot orphan buttons instantly.
              if (b.targets && b.targets.length > 0) {
                el.classList.add('button-wired');
              }
              for (const t of b.targets) {
                if (!inBounds(t.c, t.r)) continue;
                const tel = cellEls[t.r] && cellEls[t.r][t.c];
                if (tel) tel.classList.add('button-wire-target');
              }
            }
          }
          // The button currently being wired gets a distinct dashed amber
          // outline so the user can see which button they're editing.
          if (state.editMode && editor.tool === 'wire-button' && editor.wireSrc) {
            const wel = cellEls[editor.wireSrc.r] && cellEls[editor.wireSrc.r][editor.wireSrc.c];
            if (wel) wel.classList.add('button-wire-source');
          }
        }
        // Wire info panel: show/hide + populate based on edit mode +
        // active wire selection. Lives outside the buttons[] block so it
        // updates correctly even before any buttons are placed.
        renderButtonWireInfo();

        // Spiders (after env so they sit on top; a cell can have multiple spiders).
        // Cosmetic-only: spider-free mode renders worms instead of spiders.
        const spiderGlyph = state.spiderFree ? '🐛' : '🕷';
        const spiderCounter = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
        for (const sp of state.spiders) {
          if (!sp.alive) continue;
          const el = cellEls[sp.r] && cellEls[sp.r][sp.c];
          if (!el) continue;
          const idx = ++spiderCounter[sp.r][sp.c];
          const node = document.createElement('span');
          let cls = idx === 1 ? 'spider' : `spider s${Math.min(idx, 4)}`;
          if (sp.isBaby) cls += ' baby';
          node.className = cls;
          node.textContent = spiderGlyph;
          el.appendChild(node);
        }

        // Player tokens with facing arrows. Group players that share a cell so we
        // can position them around the cell (2 side-by-side, 3 in a triangle).
        const cellGroups = {};
        state.players.forEach((p, i) => {
          if (p.status !== 'on-grid') return;
          if (i === hideActiveIdx) return; // animator is drawing this player as a floating overlay
          const key = `${p.r},${p.c}`;
          if (!cellGroups[key]) cellGroups[key] = [];
          cellGroups[key].push({ p, i });
        });

        Object.values(cellGroups).forEach((group) => {
          group.forEach(({ p, i }, gIdx) => {
            const el = cellEls[p.r][p.c];
            const tok = document.createElement('div');
            const stackedClass = group.length >= 2
              ? ` stacked stacked-of-${group.length} stacked-pos-${gIdx}`
              : '';
            tok.className =
              `token p${i + 1}` +
              stackedClass +
              ((p.weapons || 0) > 0 ? ' armed' : '') +
              (p.invisibleTurnsLeft > 0 ? ' invisible' : '');
            if ((p.weapons || 0) > 0) {
              // Show the Spider Knife inside the circle when armed.
              tok.innerHTML = '<span class="knife-icon">🗡</span>';
            } else {
              // Otherwise show the player's name (truncated to fit the circle).
              const label = (p.name || `P${i + 1}`).slice(0, 3);
              tok.textContent = label;
            }
            // Direction arrow
            if (p.lastDir && (p.lastDir.dc !== 0 || p.lastDir.dr !== 0)) {
              const arrow = document.createElement('span');
              arrow.className = 'dir-arrow';
              const d = p.lastDir;
              let rotate = 0, top = '-3px', left = '50%';
              if (d.dc === 0 && d.dr === -1) { rotate = 0;   top = '-3px';  left = '50%';  }
              if (d.dc === 1 && d.dr === 0)  { rotate = 90;  top = '50%';  left = 'calc(100% + 3px)'; }
              if (d.dc === 0 && d.dr === 1)  { rotate = 180; top = 'calc(100% + 3px)'; left = '50%'; }
              if (d.dc === -1 && d.dr === 0) { rotate = 270; top = '50%';  left = '-3px'; }
              arrow.style.top = top;
              arrow.style.left = left;
              arrow.style.transform = `translate(-50%, -50%) rotate(${rotate}deg)`;
              tok.appendChild(arrow);
            }
            el.appendChild(tok);
          });
        });

        // Legal-move highlights (suppressed in edit mode)
        if (!state.editMode && state.winner === null) {
          const moves = legalMoves(state.currentPlayer);
          for (const m of moves) {
            const el = cellEls[m.r][m.c];
            el.classList.add('legal');
            if (state.currentPlayer === 1) el.classList.add('p2');
            else if (state.currentPlayer === 2) el.classList.add('p3');
          }
        }

        // Process queued one-shot FX (TRAPPED!, BOOM!) — self-clean on animationend.
        // Skip while a player traverse animation is in flight: movePlayer
        // queues fx (boom/sizzle/lavakill on rocks pushed onto hazards,
        // slide/river chain side effects) up-front, but the animator runs
        // one render({ hideActiveIdx }) BEFORE sliding the token. Without
        // this guard the boom toast paints on the destination cell while
        // the token is still at its origin, so the effect arrives before
        // the entity does. animateThenFinalize sets state.animating to
        // false right before calling finalizeMove, so the post-animation
        // render in finalizeMove drains the same queue at the correct time.
        if (state.pendingFx && state.pendingFx.length && !state.animating) {
          for (const fx of state.pendingFx) {
            const cell = cellEls[fx.r] && cellEls[fx.r][fx.c];
            if (!cell) continue;
            if (fx.type === 'trapped') {
              const node = document.createElement('span');
              node.className = 'fx-trapped';
              node.textContent = 'TRAPPED!';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'boom') {
              const wrap = document.createElement('div');
              wrap.className = 'fx-boom';
              const burst = document.createElement('span');
              burst.className = 'burst';
              const text = document.createElement('span');
              text.className = 'text';
              text.textContent = 'BOOM!';
              wrap.appendChild(burst);
              wrap.appendChild(text);
              text.addEventListener('animationend', () => wrap.remove());
              cell.appendChild(wrap);
            } else if (fx.type === 'lavakill') {
              // Lava kill: dramatic burst + "SSSSS!" text. Used when a
              // player walks into lava or a spider blunders into it.
              const wrap = document.createElement('div');
              wrap.className = 'fx-lavakill';
              const burst = document.createElement('span');
              burst.className = 'burst';
              const text = document.createElement('span');
              text.className = 'text';
              text.textContent = 'SSSSS!';
              wrap.appendChild(burst);
              wrap.appendChild(text);
              text.addEventListener('animationend', () => wrap.remove());
              cell.appendChild(wrap);
            } else if (fx.type === 'sizzle') {
              const wrap = document.createElement('div');
              wrap.className = 'fx-sizzle';
              const puff = document.createElement('span');
              puff.className = 'puff';
              const text = document.createElement('span');
              text.className = 'text';
              text.textContent = 'sssssss!';
              wrap.appendChild(puff);
              wrap.appendChild(text);
              text.addEventListener('animationend', () => wrap.remove());
              cell.appendChild(wrap);
            } else if (fx.type === 'zap') {
              const node = document.createElement('span');
              node.className = 'fx-zap';
              node.textContent = 'ZAP!';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'eaten') {
              const node = document.createElement('span');
              node.className = 'fx-eaten';
              node.textContent = 'EATEN!';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'pickup') {
              const node = document.createElement('span');
              node.className = 'fx-pickup';
              node.textContent = wormify('Spider knife found!');
              node.style.transform = 'translate(-50%, -50%)';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'invisible') {
              const node = document.createElement('span');
              node.className = 'fx-pickup potion';
              node.textContent = `Spider Freeze potion! ${INVISIBILITY_TURNS} turns`;
              node.style.transform = 'translate(-50%, -50%)';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'potion-stored') {
              const node = document.createElement('span');
              node.className = 'fx-pickup potion';
              node.textContent = 'Potion stored! Press P to drink';
              node.style.transform = 'translate(-50%, -50%)';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'cake') {
              const node = document.createElement('span');
              node.className = 'fx-pickup cake';
              node.innerHTML = '&#x1F370; Cake! +100';
              node.style.transform = 'translate(-50%, -50%)';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'key') {
              const node = document.createElement('span');
              node.className = 'fx-pickup key';
              node.innerHTML = '&#x1F511; You found a key!';
              node.style.transform = 'translate(-50%, -50%)';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'visible') {
              const node = document.createElement('span');
              node.className = 'fx-info';
              node.textContent = 'Visible again';
              node.style.transform = 'translate(-50%, -50%)';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'wire-confirmed') {
              // Editor toast: button wiring finished with >= 1 target.
              const node = document.createElement('span');
              node.className = 'fx-wire-ok';
              const n = fx.count || 0;
              node.textContent = '✓ Button wired — ' + n + ' target' + (n === 1 ? '' : 's');
              node.style.transform = 'translate(-50%, -50%)';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'wire-empty') {
              // Editor toast: user clicked the source button to finish but
              // never selected any targets. Surface the no-op explicitly.
              const node = document.createElement('span');
              node.className = 'fx-wire-warn';
              node.textContent = '⚠ No targets — nothing wired';
              node.style.transform = 'translate(-50%, -50%)';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'love') {
              const node = document.createElement('span');
              node.className = 'fx-love';
              node.textContent = '❤️';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'baby') {
              // Companion to the 'love' heart: a pink toast on the
              // birth cell so the player notices the new baby spider.
              const node = document.createElement('span');
              node.className = 'fx-pickup baby';
              node.textContent = '🕷 Baby Spider!';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'pet') {
              // Petting-zoo: green heart pop + one of three random
              // labels ("Awww!", "You pet the spider!", "Who's a good
              // spider?"). The slot index (0..5) drives a CSS fan-out
              // so back-to-back pets on the same cell don't pile up.
              const heart = document.createElement('span');
              heart.className = 'fx-heart-green';
              heart.textContent = '💚';
              heart.addEventListener('animationend', () => heart.remove());
              cell.appendChild(heart);
              const label = document.createElement('span');
              label.className = 'fx-pet';
              label.dataset.slot = String(fx.slot || 0);
              label.textContent = fx.label || 'You pet the spider!';
              label.addEventListener('animationend', () => label.remove());
              cell.appendChild(label);
            } else if (fx.type === 'ouch') {
              // Petting-zoo: player held a knife and "pet" with it.
              // Red toast on the spider's death cell; −100 score event
              // is logged separately via addScore.
              const node = document.createElement('span');
              node.className = 'fx-pickup ouch';
              node.textContent = 'OW! You hurt me!';
              node.style.transform = 'translate(-50%, -50%)';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            } else if (fx.type === 'spider-exit') {
              // Petting-zoo: a spider reached IN — slide a pink spider
              // glyph off the IN cell (anchored on IN, animates outward
              // via the .fx-spider-exit keyframes) before despawning.
              const node = document.createElement('span');
              node.className = 'fx-spider-exit';
              node.textContent = '🕷';
              node.addEventListener('animationend', () => node.remove());
              cell.appendChild(node);
            }
          }
          state.pendingFx = [];
        }

        const statusLine = document.getElementById('status-line');
        const goCard = document.getElementById('game-over-card');
        const goText = document.getElementById('game-over-text');

        const cur = state.currentPlayer;
        const curP = state.players[cur];

        if (state.winner !== null) {
          statusLine.textContent = '';
          goCard.style.display = '';
          const winP = state.players[state.winner];
          const name = winP ? winP.name : `Player ${state.winner + 1}`;
          goText.textContent = `${name} cleared all ${MAX_LEVEL} levels — game over!`;
        } else {
          goCard.style.display = 'none';
          // Find a (non-current) trapped player to call out, if any.
          let trappedIdx = -1;
          for (let i = 0; i < state.players.length; i++) {
            if (i === cur) continue;
            const o = state.players[i];
            if (o.skipNext && o.status !== 'exited') { trappedIdx = i; break; }
          }
          if (trappedIdx >= 0) {
            const oP = state.players[trappedIdx];
            statusLine.innerHTML =
              `${oP.name} is <strong style="color:var(--lava)">trapped</strong>` +
              ` — ${curP.name}'s turn.`;
          } else if (curP.status === 'off-grid') {
            statusLine.innerHTML = `${curP.name}: click anywhere to enter through <strong style="color:var(--in)">IN</strong>.`;
          } else if (legalMoves(cur).length === 0) {
            // Soft-lock: the current player has no legal moves at all (e.g.
            // jumped onto a wall cell with all four sides blocked). We do NOT
            // auto-reset — the player must choose to use the Reset Level
            // button so they don't lose progress unexpectedly.
            statusLine.innerHTML =
              `${curP.name} is <strong style="color:var(--wall)">stuck</strong>` +
              ` — no legal moves. Click <strong>Reset Level</strong> to start this level over.`;
          } else {
            statusLine.innerHTML = `${curP.name}: click in any direction to step that way.`;
          }
        }

        const renderBadge = (badgeEl, p, idx) => {
          if (!badgeEl) return;
          badgeEl.classList.remove('active', 'p2', 'p3', 'exited');
          if (p.status === 'exited') {
            badgeEl.classList.add('exited');
            badgeEl.textContent = 'exited';
          } else if (state.winner === null && idx === cur) {
            badgeEl.classList.add('active');
            if (idx === 1) badgeEl.classList.add('p2');
            else if (idx === 2) badgeEl.classList.add('p3');
            // Single-player: it's always this player's turn, so the
            // "your turn · …" prefix is redundant noise. Just show their
            // current spot (or "off-grid" before they enter through IN).
            badgeEl.textContent = p.status === 'off-grid'
              ? 'off-grid'
              : `at ${p.c + 1},${p.r + 1}`;
          } else {
            badgeEl.textContent = p.status === 'off-grid'
              ? 'off-grid'
              : `at ${p.c + 1},${p.r + 1}`;
          }
        };
        state.players.forEach((p, i) => {
          const badge = document.getElementById(`p${i + 1}-badge`);
          renderBadge(badge, p, i);
          // Refresh display name in the player row in case it changed at setup.
          const nameEl = document.getElementById(`p${i + 1}-name`);
          if (nameEl) nameEl.textContent = p.name;
        });

        // Loadout (weapon held + invisibility timer if active)
        const loadoutText = (p) => {
          const parts = [];
          const wpn = p.weapons || 0;
          if (wpn > 0) {
            const knifeWord = wormify('Spider Knife');
            const spiderWord = wormify('spider');
            const pluralKnives = wpn > 1 ? `${wpn} ${knifeWord}s` : `1 ${knifeWord}`;
            const killsTail = wpn > 1
              ? `kills next ${wpn} ${spiderWord}s`
              : `kills next ${spiderWord}`;
            parts.push(`<span style="color:var(--weapon);font-weight:700;">🗡 ${pluralKnives} ready</span> · ${killsTail}`);
          }
          if (p.invisibleTurnsLeft > 0) {
            const t = p.invisibleTurnsLeft;
            parts.push(`<span style="color:var(--accent-cyan);font-weight:700;">👻 Invisible</span> · ${t} turn${t === 1 ? '' : 's'} left`);
          } else if ((p.potions || 0) > 0) {
            const pn = p.potions;
            parts.push(`<span style="color:var(--accent-cyan);font-weight:700;">🧪 ${pn} Potion${pn > 1 ? 's' : ''}</span> · press <strong>P</strong> to drink`);
          }
          const ky = p.keys || 0;
          if (ky > 0) {
            parts.push(`<span style="color:var(--key);font-weight:700;">🔑 ${ky} Key${ky > 1 ? 's' : ''}</span> · unlocks ${ky === 1 ? '1 cell' : `${ky} cells`}`);
          }
          return parts.length ? parts.join(' · ') : 'no items';
        };
        state.players.forEach((p, i) => {
          const load = document.getElementById(`p${i + 1}-loadout`);
          if (load) load.innerHTML = loadoutText(p);
          // Drink Potion button visibility/enabled state. Visible only
          // when this player has at least one stored potion and isn't
          // already invisible (drinking while invisible is wasteful).
          // Currently only player 1 has a HUD button (single-player
          // default); the loop is structured to extend cleanly to p2/p3
          // if more buttons are added later.
          const drinkBtn = document.getElementById(`p${i + 1}-drink-potion`);
          if (drinkBtn) {
            const hasPotion = (p.potions || 0) > 0;
            const alreadyInvisible = p.invisibleTurnsLeft > 0;
            const myTurn = (state.currentPlayer === i) && !state.levelCleared && state.winner === null && !state.animating;
            const show = hasPotion && p.status === 'on-grid';
            drinkBtn.classList.toggle('hidden', !show);
            drinkBtn.disabled = !show || alreadyInvisible || !myTurn;
            drinkBtn.style.opacity = drinkBtn.disabled ? '0.45' : '1';
            drinkBtn.style.cursor = drinkBtn.disabled ? 'default' : 'pointer';
          }
        });

        // Hazard counts
        const spiderCount = document.getElementById('spider-count');
        const weaponCount = document.getElementById('weapon-count');
        if (spiderCount) {
          // Spiders are removed from the game on death, so this is the live total.
          // Show baby count separately when there are any.
          const aliveTotal = state.spiders.length;
          const babies = state.spiders.filter((s) => s.isBaby).length;
          spiderCount.textContent = babies > 0
            ? `${aliveTotal} (${babies} baby)`
            : String(aliveTotal);
        }
        if (weaponCount) {
          let n = 0;
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              if (state.weapons[r][c] || state.potions[r][c]) n++;
            }
          }
          weaponCount.textContent = String(n);
        }

        // Level indicator in the Turn card header.
        // All slots in LEVEL_ORDER are themed; slots beyond LEVEL_ORDER
        // show "Level N / max". Numbers shown to the user are 1-indexed
        // (state.level is 0-indexed internally).
        const levelEl = document.getElementById('level-display');
        if (levelEl) {
          // Custom layouts may carry their own player-authored name; that
          // takes priority over the built-in LEVEL_NAMES table so saved
          // levels read with the title the player gave them.
          const customSnap = state.customLevels && state.customLevels[state.level];
          const customName = customSnap && customSnap.name;
          const themed = customName || LEVEL_NAMES[state.level];
          const displayLevel = state.level + 1;
          let label = themed
            ? `Level ${displayLevel}: ${themed}`
            : `Level ${displayLevel} / ${MAX_LEVEL}`;
          // (Custom) suffix intentionally suppressed — players don't need
          // to know whether a level slot has been overwritten via the
          // Save-layout tool, and the suffix was cluttering the banner.
          levelEl.textContent = wormify(label);
        }
        // Turn counter in the Turn card body. Counts player commits on this
        // level. Resets to 0 in init().
        const turnCounterNum = document.getElementById('turn-counter-num');
        if (turnCounterNum) turnCounterNum.textContent = String(state.turnsThisLevel || 0);
        // "Min N" floor: the lowest possible solo turn count to clear the
        // current level (BFS over env/walls/portals; ignores spiders +
        // rocks-as-pushable). Recomputed every render so it stays in sync
        // with the Edit-cells tool. "—" if unreachable.
        const minTurnsEl = document.getElementById('min-turns');
        if (minTurnsEl) {
          const min = computeMinTurnsToOut();
          minTurnsEl.textContent = (min == null) ? '—' : String(min);
        }
        // Effects and Hazards legend: show every entry from the start,
        // regardless of which level introduces it or whether the player
        // has opened a matching chest. The progressive-reveal logic that
        // used to gate this on level number and chest discovery has been
        // intentionally retired in favor of always-on visibility.
        const legendEl = document.getElementById('board-legend');
        if (legendEl) {
          for (const li of legendEl.querySelectorAll('li[data-feature]')) {
            li.style.display = '';
          }
          legendEl.style.display = '';
        }

        // Score panel: total + last-5 log of point-earning events.
        const scoreValEl = document.getElementById('score-value');
        if (scoreValEl) scoreValEl.textContent = String(state.score || 0);
        // Keep the Undo button enable/disable state in sync with the
        // snapshot lifecycle (cleared after consume, refreshed after move).
        if (typeof updateUndoButton === 'function') updateUndoButton();
        const scoreLogEl = document.getElementById('score-log');
        const scoreLogEmpty = document.getElementById('score-log-empty');
        if (scoreLogEl) {
          scoreLogEl.innerHTML = '';
          for (const entry of state.scoreLog) {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:1px 0;border-top:1px solid #1a2030;';
            const sign = entry.points >= 0 ? '+' : '';
            li.innerHTML = `<span>${entry.label}</span><span style="color:var(--weapon);font-weight:700;">${sign}${entry.points}</span>`;
            scoreLogEl.appendChild(li);
          }
          if (scoreLogEmpty) scoreLogEmpty.style.display = state.scoreLog.length ? 'none' : '';
        }
        // Highlight the active level-jump button.
        const jumpRow = document.getElementById('level-jump-row');
        if (jumpRow) {
          for (const btn of jumpRow.children) {
            const lvl = Number(btn.dataset.level);
            btn.classList.toggle('active', lvl === state.level);
          }
        }

        // Off-grid staging: position the staging slot adjacent to the IN
        // cell and render a colored puck for each off-grid player paired
        // with a green arrow pointing AT the IN cell. The slot is one
        // cell tall and the puck/arrow split the slot in half so the
        // arrow always renders on the IN-facing side. When the puck is
        // visible the standalone #in-arrow is hidden (the in-slot arrow
        // here replaces it); when all players are on-grid the staging
        // div hides and #in-arrow takes over again.
        const stagingEl = document.getElementById('off-grid-staging');
        let puckEdge = null;
        if (stagingEl) {
          const offGridPlayers = state.players
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => p.status === 'off-grid');
          const inCell = cellEls[IN_CELL.r] && cellEls[IN_CELL.r][IN_CELL.c];
          if (offGridPlayers.length === 0 || !inCell) {
            stagingEl.classList.remove('visible', 'count-1', 'count-2', 'count-3', 'edge-left', 'edge-right', 'edge-top', 'edge-bottom', 'edge-overlay');
            stagingEl.innerHTML = '';
          } else {
            // Decide which edge of the grid IN sits closest to and
            // anchor the staging slot on the OUTSIDE of that edge.
            // Tie-break order left → right → top → bottom matches the
            // IN-arrow edge picker in placeEdgeArrow() below, so the
            // standalone arrow (hidden while pucks are visible) and the
            // in-slot arrow share the same edge convention.
            //
            // Earlier versions just tried LEFT first and accepted any
            // slot that fit inside #board-wrap, but that placed the
            // puck INSIDE the grid whenever IN was on the right or
            // bottom edge (e.g. Ford the River's IN at col 9). The
            // grid-edge-distance check below guarantees the puck
            // always lands on the outside.
            const w = inCell.offsetWidth;
            const h = inCell.offsetHeight;
            const dL = IN_CELL.c;
            const dR = COLS - 1 - IN_CELL.c;
            const dT = IN_CELL.r;
            const dB = ROWS - 1 - IN_CELL.r;
            const minEdge = Math.min(dL, dR, dT, dB);
            if (dL === minEdge) puckEdge = 'left';
            else if (dR === minEdge) puckEdge = 'right';
            else if (dT === minEdge) puckEdge = 'top';
            else puckEdge = 'bottom';
            let left, top;
            if (puckEdge === 'left') {
              left = boardEl.offsetLeft + inCell.offsetLeft - w;
              top  = boardEl.offsetTop  + inCell.offsetTop;
            } else if (puckEdge === 'right') {
              left = boardEl.offsetLeft + inCell.offsetLeft + w;
              top  = boardEl.offsetTop  + inCell.offsetTop;
            } else if (puckEdge === 'top') {
              left = boardEl.offsetLeft + inCell.offsetLeft;
              top  = boardEl.offsetTop  + inCell.offsetTop - h;
            } else {
              left = boardEl.offsetLeft + inCell.offsetLeft;
              top  = boardEl.offsetTop  + inCell.offsetTop + h;
            }
            // If the chosen slot would spill outside #board-wrap (rare,
            // only on very small viewports), fall back to overlaying IN.
            if (left < 0 || top < 0) {
              left = boardEl.offsetLeft + inCell.offsetLeft;
              top  = boardEl.offsetTop  + inCell.offsetTop;
              puckEdge = 'overlay';
            }
            stagingEl.style.left = left + 'px';
            stagingEl.style.top  = top + 'px';
            stagingEl.style.width  = w + 'px';
            stagingEl.style.height = h + 'px';
            stagingEl.classList.add('visible');
            stagingEl.classList.remove('count-1', 'count-2', 'count-3', 'edge-left', 'edge-right', 'edge-top', 'edge-bottom', 'edge-overlay');
            stagingEl.classList.add(`count-${offGridPlayers.length}`);
            stagingEl.classList.add(`edge-${puckEdge}`);
            // Build the slot contents: a .off-grid-pucks half on the
            // OUTER side (away from IN) and a .off-grid-cue half on
            // the INNER side (facing IN). When edge === 'overlay' we
            // skip the arrow entirely since there's no outer side.
            stagingEl.innerHTML = '';
            const pucksHalf = document.createElement('div');
            pucksHalf.className = 'off-grid-pucks';
            for (const { p, i } of offGridPlayers) {
              const puck = document.createElement('div');
              puck.className = `off-grid-puck p${i + 1}`;
              puck.title = `${p.name} — click anywhere to enter via IN`;
              const label = (p.name || `P${i + 1}`).slice(0, 2);
              puck.textContent = label;
              pucksHalf.appendChild(puck);
            }
            if (puckEdge === 'overlay') {
              stagingEl.appendChild(pucksHalf);
            } else {
              const cueHalf = document.createElement('div');
              cueHalf.className = 'off-grid-cue';
              // Arrow always points FROM the puck side TOWARD IN.
              cueHalf.textContent =
                puckEdge === 'left'   ? '▶'
              : puckEdge === 'right'  ? '◀'
              : puckEdge === 'top'    ? '▼'
              :                         '▲'; // bottom
              // Pucks render on the OUTER half, arrow on the INNER
              // (IN-facing) half. The flex-direction on the parent
              // (.edge-* CSS rules) controls which way they line up,
              // so we just append pucks then arrow in source order.
              stagingEl.appendChild(pucksHalf);
              stagingEl.appendChild(cueHalf);
            }
          }
        }

        // ── Edge arrows for IN / OUT ────────────────────────────────
        // Green arrow points AT the IN cell from just outside the grid;
        // red arrow points AWAY FROM the OUT cell from just outside the
        // grid. Each arrow occupies a virtual cell-sized slot adjacent
        // to its target cell on whichever edge of the grid is closest.
        // Edge priority left → right → top → bottom resolves corner
        // ties so the default IN (0,0) anchors LEFT and default OUT
        // (9,9) anchors RIGHT — matching natural left-to-right reading.
        const inArrowEl  = document.getElementById('in-arrow');
        const outArrowEl = document.getElementById('out-arrow');
        const wrapEl     = document.getElementById('board-wrap');
        if (inArrowEl && outArrowEl && wrapEl) {
          // Use getBoundingClientRect so the arrow hugs the board's outer
          // border edge precisely (offsetLeft/offsetTop math doesn't
          // account for #board's 3px frame border).
          const wrapRect  = wrapEl.getBoundingClientRect();
          const boardRect = boardEl.getBoundingClientRect();
          const placeEdgeArrow = (el, c, r, kind) => {
            const cell = cellEls[r] && cellEls[r][c];
            if (!cell || cell.offsetWidth === 0) {
              el.classList.remove('visible');
              return;
            }
            const cellRect = cell.getBoundingClientRect();
            const w = cellRect.width;
            const h = cellRect.height;
            const dL = c, dR = COLS - 1 - c, dT = r, dB = ROWS - 1 - r;
            const minEdge = Math.min(dL, dR, dT, dB);
            let edge;
            if (dL === minEdge) edge = 'left';
            else if (dR === minEdge) edge = 'right';
            else if (dT === minEdge) edge = 'top';
            else edge = 'bottom';
            const isIn = (kind === 'in');
            let left, top, glyph;
            if (edge === 'left') {
              // Arrow's right edge butts against board's outer left border.
              left  = boardRect.left - wrapRect.left - w;
              top   = cellRect.top  - wrapRect.top;
              glyph = isIn ? '▶' : '◀';
            } else if (edge === 'right') {
              // Arrow's left edge butts against board's outer right border.
              left  = boardRect.right - wrapRect.left;
              top   = cellRect.top   - wrapRect.top;
              glyph = isIn ? '◀' : '▶';
            } else if (edge === 'top') {
              left  = cellRect.left - wrapRect.left;
              top   = boardRect.top - wrapRect.top - h;
              glyph = isIn ? '▼' : '▲';
            } else {
              left  = cellRect.left   - wrapRect.left;
              top   = boardRect.bottom - wrapRect.top;
              glyph = isIn ? '▲' : '▼';
            }
            el.style.left   = left + 'px';
            el.style.top    = top  + 'px';
            el.style.width  = w    + 'px';
            el.style.height = h    + 'px';
            el.textContent  = glyph;
            el.classList.add('visible');
          };
          // The off-grid staging slot renders its own IN-pointing arrow
          // next to the puck, so suppress the standalone #in-arrow when
          // any player is off-grid to avoid two arrows fighting for the
          // same space. Once everyone is on-grid the staging slot
          // hides and the standalone arrow takes back over.
          if (puckEdge) {
            inArrowEl.classList.remove('visible');
          } else {
            placeEdgeArrow(inArrowEl, IN_CELL.c, IN_CELL.r, 'in');
          }
          // Some levels (e.g. "No Way Out") deliberately hide OUT under a
          // rock or terrain feature, in which case the side arrow would
          // spoil the puzzle. The level definition opts out via
          // hideOutArrow: true.
          if (getLayout(state.level)?.hideOutArrow) {
            outArrowEl.classList.remove('visible');
          } else {
            placeEdgeArrow(outArrowEl, OUT_CELL.c, OUT_CELL.r, 'out');
          }
        }
      }

      // ── Setup overlay flow ───────────────────────────────────────────────
      // Single-player only: chosenPlayerCount is hard-coded to 1 and there
      // is no player-count picker in the modal. State still carries the
      // numPlayers field for compatibility with the rest of the engine.
      const setupOverlay = document.getElementById('setup-overlay');
      const startBtn     = document.getElementById('start-btn');
      const chosenPlayerCount = 1;

      function showSetup() {
        setupOverlay.classList.remove('hidden');
        // Pre-fill name from current state so Reset preserves what was typed.
        const inp = document.getElementById('name-1');
        if (inp) inp.value = (state.playerNames[0] || '').trim();
        const sf = document.getElementById('spider-free-toggle');
        if (sf) sf.checked = !!state.spiderFree;
        const hc = document.getElementById('high-contrast-toggle');
        if (hc) hc.checked = document.body.classList.contains('high-contrast');
      }
      function hideSetup() {
        setupOverlay.classList.add('hidden');
      }
      function startFromSetup() {
        const inp = document.getElementById('name-1');
        const v = (inp && inp.value || '').trim();
        state.numPlayers  = chosenPlayerCount;
        state.playerNames = [v || 'Player 1'];
        const sf = document.getElementById('spider-free-toggle');
        state.spiderFree = !!(sf && sf.checked);
        // Mirror onto the in-game Controls-panel checkbox so the two
        // toggles stay in sync from the very first turn.
        const sfControls = document.getElementById('spider-free-toggle-controls');
        if (sfControls) sfControls.checked = state.spiderFree;
        // High-contrast mode is purely visual, so we don't store it on
        // game state — just flip the body class and persist the choice
        // so it survives a reload.
        const hc = document.getElementById('high-contrast-toggle');
        applyHighContrast(!!(hc && hc.checked));
        state.level = 0;
        // Full game reset: zero out the running score + log and forget any
        // chest-content discoveries from the previous game.
        state.score = 0;
        state.scoreLog = [];
        state.discovered = { knife: null, potion: null };
        hideSetup();
        init();
      }
      startBtn.addEventListener('click', startFromSetup);

      // High-contrast toggle: live-apply on change so the splash itself
      // re-themes immediately. Defaults to OFF on every page load — HC is
      // an opt-in accessibility option, not a sticky preference, so each
      // session starts in default theme and the player can re-enable HC
      // from the splash as needed. Also clear any legacy stored value
      // from earlier builds that did persist the choice.
      // Two checkboxes drive the same toggle: one on the splash overlay
      // and one in the in-game Controls panel. They are kept in sync so
      // the player can flip HC on/off mid-game without going back to the
      // splash screen.
      const HIGH_CONTRAST_STORAGE_KEY = 'spiders3.highContrast';
      try { localStorage.removeItem(HIGH_CONTRAST_STORAGE_KEY); } catch (e) { /* best effort */ }
      function applyHighContrast(enabled) {
        const on = !!enabled;
        document.body.classList.toggle('high-contrast', on);
        const a = document.getElementById('high-contrast-toggle');
        const b = document.getElementById('high-contrast-toggle-controls');
        if (a) a.checked = on;
        if (b) b.checked = on;
      }
      const hcToggle = document.getElementById('high-contrast-toggle');
      if (hcToggle) {
        hcToggle.checked = false;
        hcToggle.addEventListener('change', (e) => {
          applyHighContrast(!!e.target.checked);
        });
      }
      const hcToggleControls = document.getElementById('high-contrast-toggle-controls');
      if (hcToggleControls) {
        hcToggleControls.checked = false;
        hcToggleControls.addEventListener('change', (e) => {
          applyHighContrast(!!e.target.checked);
        });
      }

      // Spider-free toggle: same splash <-> in-game mirror pattern as HC.
      // The splash one is set at game start (state.spiderFree is read in
      // startFromSetup); the in-game one in the Controls panel lets the
      // player flip mode mid-run without restarting. Toggling here flips
      // state.spiderFree, re-applies the cached static text swaps via
      // applySpiderFreeText(), and re-renders the board so spider/worm
      // glyphs swap in place. We sync both checkboxes so they always
      // reflect the same source of truth.
      function applySpiderFree(enabled) {
        const on = !!enabled;
        state.spiderFree = on;
        const a = document.getElementById('spider-free-toggle');
        const b = document.getElementById('spider-free-toggle-controls');
        if (a) a.checked = on;
        if (b) b.checked = on;
        document.body.classList.toggle('spider-free-mode', on);
        if (typeof applySpiderFreeText === 'function') applySpiderFreeText();
        if (typeof render === 'function') render();
      }
      const sfToggleControls = document.getElementById('spider-free-toggle-controls');
      if (sfToggleControls) {
        sfToggleControls.checked = !!state.spiderFree;
        sfToggleControls.addEventListener('change', (e) => {
          applySpiderFree(!!e.target.checked);
        });
      }

      // Undo button: rewinds the last player move. Single-shot — the
      // button disables itself until the player commits another move,
      // which re-arms a fresh snapshot at the top of movePlayer.
      const undoBtn = document.getElementById('undo-btn');
      if (undoBtn) {
        undoBtn.addEventListener('click', () => {
          if (canUndo()) undoLastMove();
        });
      }
      // Rebuild the current level (same player setup, same level number,
      // fresh randomized board / spiders / items). Shared by the "Reset
      // level" button and the "Edit cells" button — entering edit mode
      // wipes the in-flight game so the editor starts from a clean board.
      function resetCurrentLevel() {
        if (!state.players || state.players.length === 0) return;
        // Tear down any in-flight traverse animation before rebuilding.
        removeAnimatedToken();
        state.animating = false;
        state.pendingPath = null;
        state.spiders = [];
        state.pendingFx = [];
        state.winner = null;
        // Undo doesn't survive a full level rebuild — clear any armed
        // snapshot so the button shows as disabled after reset.
        state.undoSnapshot = null;
        // A level reset is a clean restart of the current level: drop any
        // pending carry-over so the player doesn't get free items, and
        // dismiss the Level Cleared modal if it happens to be up.
        state.carryOver = null;
        // Roll the score back to whatever the player had at level start —
        // any points or penalties earned during the failed attempt are
        // discarded. Also wipe the rolling 5-entry score log so the side
        // panel reflects the clean slate. init() will re-snapshot the
        // score under scoreAtLevelStart at the end of setup.
        if (typeof state.scoreAtLevelStart === 'number') {
          state.score = state.scoreAtLevelStart;
          state.scoreLog = [];
        }
        init();
        // Mark this attempt as no longer eligible for the +300 first-try
        // bonus. Must be set AFTER init(), which clears diedThisLevel as
        // part of its per-level reset. The flag persists across the rest
        // of this attempt until the next level transition init() clears it.
        state.diedThisLevel = true;
      }
      document.getElementById('reset-level-btn').addEventListener('click', () => {
        // Guard against silently destroying unsaved editor edits. The
        // helper is a no-op when there's nothing dirty.
        if (!confirmDiscardEdits('Resetting the level')) return;
        // Remember whether we were in edit mode so we can re-enter
        // after reset finishes. resetCurrentLevel() calls init() which
        // clears state.editMode + the body class; without this the
        // user would silently drop out of edit mode every time they
        // hit Reset, even when they intended to keep editing.
        const wasEditing = !!state.editMode;
        resetCurrentLevel();
        if (wasEditing) {
          state.editMode = true;
          document.body.classList.add('edit-mode');
          setEditButtonLabel(true);
          // Fresh post-reset board is clean — clear the dirty flag and
          // sync the badge so it disappears.
          state.editorDirty = false;
          syncDirtyBadge();
          // Default tool stays whatever the user had selected so they
          // can immediately resume the same edit pattern.
          render();
        }
      });
      // Drink Potion button (HUD, per-player). Currently only player 1
      // has a button; the loop runs over 1..3 in case more are added.
      for (let i = 1; i <= 3; i++) {
        const btn = document.getElementById(`p${i}-drink-potion`);
        if (!btn) continue;
        btn.addEventListener('click', () => {
          // Only the active player's button can fire; render() already
          // disables the others. Belt-and-braces: drinkPotion guards on
          // currentPlayer internally.
          if (state.currentPlayer === (i - 1)) drinkPotion();
        });
      }
      // Next Level: dismissed from the Level Cleared modal. Advances the
      // level counter and re-runs init(), which consumes state.carryOver
      // (set in finalizeMove) to restore each player's weapons + invisibility.
      const nextLevelBtn = document.getElementById('next-level-btn');
      if (nextLevelBtn) {
        nextLevelBtn.addEventListener('click', () => {
          if (!state.levelCleared) return;
          // Advancing past a playtest exits playtest mode — the snapshot
          // was tied to this level. (If the user wants another run,
          // they can re-enter edit mode and click Playtest again.)
          if (state._playtestSnapshot) {
            state._playtestSnapshot = null;
            syncPlaytestBanner();
          }
          state.level += 1;
          // init() flips levelCleared back off and hides the overlay.
          init();
        });
      }
      // Bonus CTA on the YOU-WON modal: jump straight to the petting
      // zoo (skipping the Sandbox slot). showLevelClearedModal gates
      // the button's visibility to the post-Ordered-Escape clear, so
      // we don't need an extra guard here beyond the levelCleared
      // bail-out shared with the primary button.
      const pettingZooBtn = document.getElementById('petting-zoo-btn');
      if (pettingZooBtn) {
        pettingZooBtn.addEventListener('click', () => {
          if (!state.levelCleared) return;
          state.level = PETTING_ZOO_LEVEL_INDEX;
          init();
        });
      }
      document.getElementById('edit-btn').addEventListener('click', () => {
        // While playtesting a draft, the EDIT MODE button is repurposed
        // as "Back to editor": clear the playtest snapshot and re-enter
        // edit mode with the same layout preserved. exitPlaytestMode
        // handles all of that.
        if (state._playtestSnapshot) {
          exitPlaytestMode();
          return;
        }
        toggleEditMode();
      });

      // ── Cell-sized border clicks ────────────────────────────────────────
      // Extends the clickable area by a one-cell-wide ring around the grid,
      // so the player can be directed across exit bars that sit on the edge
      // of the board (e.g. portals whose dashed bar points off-grid). A
      // click in the halo is translated into a virtual (c, r) pair just
      // outside the grid and routed through onCellClick — which already
      // knows how to interpret an out-of-bounds (c, r) as a directional
      // click via the dominant-axis fallback (and, for portals, the
      // bar-direction fallback).
      document.addEventListener('click', (e) => {
        // Real cell clicks already go through the per-cell listener.
        if (e.target && e.target.closest && e.target.closest('.cell')) return;
        // Don't hijack clicks on UI controls, the side panel, the legend,
        // the edit banner, the page title, or links that happen to lie
        // within the halo.
        if (e.target && e.target.closest && e.target.closest(
          'button, select, input, label, a, aside, .board-legend, .edit-banner, h1, h2'
        )) return;
        // No game running yet, or edit mode handles its own clicks.
        if (!state || !state.players || state.players.length === 0) return;
        if (state.editMode) return;
        if (state.winner !== null) return;
        if (state.levelCleared) return; // halo clicks are inert while the Level Cleared modal is up
        if (state.animating) return;
        const rect = boardEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const cellW = rect.width / COLS;
        const cellH = rect.height / ROWS;
        const c = Math.floor((e.clientX - rect.left) / cellW);
        const r = Math.floor((e.clientY - rect.top) / cellH);
        // Only accept clicks within a one-cell ring around the grid.
        if (c < -1 || c > COLS || r < -1 || r > ROWS) return;
        // In-bounds clicks are handled by the .cell listener.
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) return;
        onCellClick(c, r);
      });

      // ── Keyboard movement (arrow keys + WASD) ─────────────────────
      // Routes a directional key through onCellClick the same way a click
      // on the adjacent cell would: exact-match against legalMoves first,
      // falling back to onCellClick's directional / portal-exit logic.
      // Off-grid players take any direction key as "enter via IN".
      const KEY_DIRS = {
        ArrowUp:    { dc:  0, dr: -1 },
        ArrowDown:  { dc:  0, dr:  1 },
        ArrowLeft:  { dc: -1, dr:  0 },
        ArrowRight: { dc:  1, dr:  0 },
        w: { dc:  0, dr: -1 }, W: { dc:  0, dr: -1 },
        s: { dc:  0, dr:  1 }, S: { dc:  0, dr:  1 },
        a: { dc: -1, dr:  0 }, A: { dc: -1, dr:  0 },
        d: { dc:  1, dr:  0 }, D: { dc:  1, dr:  0 },
      };
      document.addEventListener('keydown', (e) => {
        // "P" — drink an Invisibility Potion. Handled before KEY_DIRS so
        // P is reserved from the directional set (it isn't currently a
        // direction key, but this keeps the handler order obvious).
        if (e.key === 'p' || e.key === 'P') {
          const tag = e.target && e.target.tagName;
          if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
            drinkPotion();
            return;
          }
        }
        const dir = KEY_DIRS[e.key];
        if (!dir) return;
        // Don't hijack typing in the setup screen's name fields, or any
        // future text input that ends up on the page.
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        // Mirror the click-handler early-outs so keys are inert when the
        // game isn't accepting input.
        if (!state || !state.players || state.players.length === 0) return;
        if (state.editMode) return;
        if (state.winner !== null) return;
        if (state.levelCleared) return;
        if (state.animating) return;
        const p = state.players[state.currentPlayer];
        if (!p) return;
        if (p.status === 'exited') return;
        // Arrow keys would otherwise scroll the page — suppress.
        if (e.key.startsWith('Arrow')) e.preventDefault();
        if (p.status === 'off-grid') {
          // Off-grid players can only enter via IN; any direction routes
          // through the off-grid path inside onCellClick.
          onCellClick(IN_CELL.c, IN_CELL.r);
        } else {
          // On-grid: pass the adjacent target cell to onCellClick. The
          // exact-match path inside onCellClick will pick it up if it's
          // a legal move; otherwise the directional / portal-exit
          // fallback (which uses the same dc/dr) handles edge cases
          // (out-of-bounds clicks, portal bars, etc.).
          onCellClick(p.c + dir.dc, p.r + dir.dr);
        }
      });

      // Enter key: trigger the primary action button on whichever single-button
      // modal is currently open. Setup overlay → Start Game; level-cleared
      // modal → Next Level. Ignored when a text input has focus so users can
      // still tab through name fields without triggering the game.
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const setupOv = document.getElementById('setup-overlay');
        if (setupOv && !setupOv.classList.contains('hidden')) {
          const btn = document.getElementById('start-btn');
          if (btn) { e.preventDefault(); btn.click(); }
          return;
        }
        const lcOv = document.getElementById('level-cleared-overlay');
        if (lcOv && !lcOv.classList.contains('hidden')) {
          const btn = document.getElementById('next-level-btn');
          if (btn) { e.preventDefault(); btn.click(); }
          return;
        }
      });

      // Build the level-jump button row. Re-runnable so the Save-layout
      // tool can call it after MAX_LEVEL grows or shrinks. The previous
      // row is wiped (along with its listeners — they were anonymous
      // closures attached to the buttons being replaced).
      function rebuildLevelJumpButtons() {
        const row = document.getElementById('level-jump-row');
        if (!row) return;
        row.innerHTML = '';
        for (let i = 0; i < MAX_LEVEL; i++) {
          // Hide the petting-zoo bonus chip until the player has cleared
          // the campaign final (sets STORAGE_KEY_PETTING_ZOO_UNLOCKED).
          if (i === PETTING_ZOO_LEVEL_INDEX && !isPettingZooUnlocked()) continue;
          const displayLevel = i + 1;
          const b = document.createElement('button');
          b.className = 'level-btn';
          b.dataset.level = String(i);
          b.textContent = String(displayLevel);
          b.title = `Jump to level ${displayLevel}`;
          // Slots whose layout comes from the user's localStorage save
          // (rather than the built-in LEVEL_ORDER entry) get a small
          // amber dot in the top-right corner via .level-btn.custom.
          // The tooltip also gains the saved level name so you can
          // tell at a glance which slots have been overridden.
          if (state.customLevels && state.customLevels[i]) {
            b.classList.add('custom');
            const customName = state.customLevels[i].name;
            if (customName) {
              b.title = `Jump to level ${displayLevel}: “${customName}” (custom save)`;
            } else {
              b.title = `Jump to level ${displayLevel} (custom save)`;
            }
          }
          b.addEventListener('click', () => {
            if (!state.players || state.players.length === 0) return;
            // Guard against silently dropping unsaved editor edits when
            // the user jumps to a different level. No-op when clean.
            if (!confirmDiscardEdits(`Jumping to level ${displayLevel}`)) return;
            // Jumping away from a playtest session exits playtest mode.
            // The draft snapshot was tied to the level the user was
            // testing; leaving that level discards it (the user can
            // re-enter edit mode and re-Playtest if they want).
            if (state._playtestSnapshot) {
              state._playtestSnapshot = null;
              syncPlaytestBanner();
            }
            removeAnimatedToken();
            state.animating = false;
            state.pendingPath = null;
            state.level = i;
            state.winner = null;
            init();
          });
          row.appendChild(b);
        }
      }
      // Initial build. Subsequent changes go through rebuildLevelJumpButtons.
      rebuildLevelJumpButtons();

      // beforeunload guard: warn the user before closing the tab or
      // reloading the page if they have unsaved editor edits. Browsers
      // only honor this if returnValue / a truthy return is set — and
      // the actual message text is ignored (browsers show their own
      // generic "Leave site? Changes you made may not be saved." UI).
      window.addEventListener('beforeunload', (e) => {
        if (!state.editorDirty) return;
        e.preventDefault();
        e.returnValue = 'You have unsaved editor edits.';
        return e.returnValue;
      });

      // First load: show setup. The board is built only after the user clicks Start.
      showSetup();
    })();
