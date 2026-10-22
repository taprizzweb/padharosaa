# Owner / manager dashboard (Phase 4)

Open `/dash` after signing in as an owner or manager (the staff screen has an "Open dashboard" button in its Account menu).
Waiters and kitchen staff are sent back to the live screen.

| Page | What it does | Who can change things |
|---|---|---|
| Menu | Categories, dishes, photos, prices, veg / non-veg / egg / Jain, spice, badges, sold out. Reorder with ↑/↓ buttons or by dragging (desktop). Select several dishes for bulk sold-out / bulk price change. Duplicate a dish. Import and export CSV. | Owner, manager |
| Dish sizes and options (in the dish editor) | **Sizes**: Small / Medium / Large / XL or Half / Full, each with its own price (ready-made size names, you add prices; a size can be switched off when sold out). The guest taps the dish and picks one; the dish shows "from" its cheapest size. **Options**: groups such as "Choose your sauce" (required, pick 1) or "Add extras" (optional, up to 3), each choice with an optional extra price. In the CSV, a `sizes` column like `Small:120|Large:200` does the same (price may then be left empty). Duplicating a dish copies them; bulk price changes move every size. | Owner, manager |
| Call for problems (on Tables & QR) | For hotels: one shared link for guests who need something. The guest types their room number, taps the problems that apply (your own list: towel, water, light, TV, WiFi...) and may write a few words. It shows on the staff screen at once under "Guest problems", with its own sound, until reception taps Done. Add the link as a button on your Smart page, or print the A4 card. The room list of Room service also checks the room number. Turn off or make a new link at any time (the old link stops). | Owner (manager can view) |
| Tables & QR | Create tables 1…N, rename, switch off, make a new QR (old printed code stops working), print an A4 QR sheet or table tents. | Owner, manager |
| Room service (on Tables & QR) | For hotels and guest houses: one shared link/QR. The guest picks or types a room number, then orders; the order appears on the staff screen as "Room 204". Optional room list (`101-110, 201`) stops wrong numbers; empty list accepts any. Turn off or make a new link at any time (the old link stops). Print an A4 card. | Owner (manager can view) |
| Staff | Add a person (temporary password shown once), change name/role, deactivate, reset password. | Owner (manager can only view) |
| Settings | Restaurant name, Google review link, accent colour, amber/red waiting minutes. Plan and paid-until are shown read-only. | Owner (manager can only view) |
| Report | Today / 7 days / 30 days: orders, average order, total sales, top 10 dishes, busiest hours, review-button taps (India time). | Owner, manager (read) |
| Activity log | Who changed what, newest first. Cannot be edited. | Owner, manager (read) |

## CSV format
Columns: `category,name,description,price,diet,spice,bestseller,chef_pick,available`. Price is in rupees. `diet` is veg, nonveg, egg or jain.
`bestseller`, `chef_pick`, `available` are yes/no. A dish with the same category and name is updated; others are added. Download the sample from the import dialog.

## How it is protected
- Every action is one JSON call to `/api/dash/<action>` (origin check, JSON only, 16 KB limit, zod validation) that runs a SQL function as the signed-in user; the database re-checks the role and the restaurant.
- Staff-account actions use the Auth admin API on the server, only after the owner is verified twice. Temporary passwords are random, shown once and never logged.
- A person with a temporary password can do nothing except choose their own password (`/account/password`).
