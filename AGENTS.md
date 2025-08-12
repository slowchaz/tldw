# AGENTS.md - Development Guidelines for TLDW

## Build/Lint/Test Commands
- `pnpm dev` - Start development server with Turbopack
- `pnpm build` - Build production application
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint checks
- No test framework configured - verify changes manually

## Code Style Guidelines

### TypeScript & Types
- Use strict TypeScript with explicit types for function parameters and returns
- Prefer `interface` over `type` for object definitions
- Use `NextRequest`/`NextResponse` for API routes

### Imports & Organization
- Group imports: external libraries first, then internal modules
- Use named imports where possible
- Import types with `import type` syntax

### Naming Conventions
- Use camelCase for variables and functions
- Use PascalCase for components and types
- Use kebab-case for file names in app directory

### Error Handling
- Use try-catch blocks for async operations
- Return structured error responses with status codes in API routes
- Log errors with context using `console.error`
- Clean up resources (files) in finally blocks

### React/Next.js Patterns
- Use 'use client' directive for client components
- Prefer functional components with hooks
- Use Tailwind CSS classes for styling
- Handle loading and error states explicitly