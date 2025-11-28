# Repository Guidelines

This monorepo bundles the web app (Vite + React + TypeScript + Tailwind) with the FastAPI/Prisma backend, so contributors should clearly separate frontend vs backend edits and follow the patterns already in place.

## Project Structure & Module Organization
- `src/` holds the mobile-first React views, hooks, and utility modules; `main.tsx` wires the router, `App.tsx` defines guarded routes, and `state/` contains the shared context.
- `server/` hosts the Express/Prisma API (TypeScript) plus Python-based FastAPI artifacts; `app/` is the primary API entry point, `prisma/` has schema/migrations, and `uploads/` is the default storage for images.
- `dist/` is the Vite production build output, `node_modules/` is managed per package-lock, and supporting docs (`README.md`, `QUICKSTART.md`, `DEPLOYMENT.md`, etc.) explain deployment and configuration.

## Build, Test, and Development Commands
- `npm install` then `npm run dev` (root) starts the Vite dev server on `http://localhost:5173`; edits reload automatically.
- `npm run build` (root) produces the production bundle under `dist/`, `npm run preview` locally serves that bundle for sanity checks.
- Backend workflow lives in `server/`: run `python -m venv .venv`, `source .venv/bin/activate`, `pip install -r requirements.txt`, then `uvicorn app.main:app --reload --port 4000` plus any Prisma seed/migrate commands (`npx prisma migrate dev`, `npx prisma db seed` when schema changes).
- `npm run dev` inside `server/` uses `tsx watch src/index.ts` for the TypeScript API layer; `npm run build` compiles to `dist/` before `npm run start`.

## Coding Style & Naming Conventions
- Frontend files use 2-space indentation, single quotes for imports, and Tailwind utility classes for layout; keep components small and favor descriptive state/prop names.
- Backend TypeScript mirrors Prisma naming (camelCase for properties, `normalize_bin_code` uses `TRASH_BIN_##` and helpers in `app/yolo_utils.py` follow snake_case).
- Keep CSS in `index.css` limited to global resets and use Tailwind for spacing/colors; linting is implicit via TypeScript/Vite checks (no formatter enforced, but stay consistent with existing formatting).

## Testing Guidelines
- Backend Python tests live under `server/tests` and use `pytest`; run them with `python -m pytest server/tests` after activating the virtual env.
- Test files are utility-focused (`test_utils.py`); name future suites `test_<feature>.py` and keep fixtures scoped tightly to avoid global state.
- Frontend currently has no automated suite, so rely on manual smoke testing via `npm run dev` and the `preview` command.

## Commit & Pull Request Guidelines
- Follow the repository’s terse history: short, present-tense commit subjects without trailing periods (e.g., `Add AWS EC2 deployment files`).
- PRs should describe what changed, why, and how to verify it; include linked issues, relevant screenshots for UI/UX edits, and mention any manual steps needed.
- Before merging, ensure both frontend and backend commands run cleanly and reference which part you exercised; mention any outstanding manual testing or migrations that need attention.

## Security & Configuration Tips
- Keep secrets in `server/.env` (copy from `.env.example`) and never commit production tokens; the FastAPI app trusts `ADMIN_TOKEN` and `SECRET_KEY` for auth.
- Store YOLO weights (`yolov8n.pt`) under `server/` or configure deployment scripts to preload them; uploads live in `server/uploads/` so treat that directory as mutable storage.
