# Naming Conventions & Code Style Guidelines

All code written in this repository MUST strictly use full, descriptive identifiers for all variables, parameters, functions, hooks, and types.

## Core Rules

1. **No Single-Letter Identifiers**:
   - Never use single-letter variables (such as `e`, `i`, `v`, `p`, `q`, `a`, `s`, `d`, `t`, `x`, `y`).
   - Use `event` or `changeEvent` instead of `e`.
   - Use `index` or `itemIndex` instead of `i`.
   - Use `error` instead of `err` or `e`.
   - Use `value` or `currentValue` instead of `v` or `val`.
   - Use `query` or `searchQuery` instead of `q`.
   - Use `isCurrentlyOpen` instead of `v` in togglers like `(isCurrentlyOpen) => !isCurrentlyOpen`.

2. **No Truncated Abbreviations**:
   - Use `parameters` instead of `params`.
   - Use `queryParameters` instead of `queryParams`.
   - Use `paginationParameters` or `paginationOptions` instead of `paginationParams`.
   - Use `queryOptions` instead of `opts` or uncontextualized `options`.
   - Use `previousState`, `previousData`, `previousItems`, `previousPatients` instead of `prev`.
   - Use `response` instead of `res`.
   - Use `request` instead of `req`.
   - Use `accumulator` instead of `acc`.
   - Use `element` or `domElement` instead of `el`.
   - Use `message` or `toastMessage` instead of `msg`.
   - Use `category` instead of `cat`.
   - Use `document` instead of `doc`.
   - Use `activity` or `activityItem` instead of `act`.

3. **Domain-Contextualized Entity Identifiers**:
   - In collection iteration (`.map()`, `.filter()`, `.find()`, `.some()`, `.every()`, `.reduce()`), use full entity nouns rather than abbreviations:
     - `(provider) => provider.id` (never `(p) => p.id`)
     - `(patient) => patient.id` (never `(p) => p.id`)
     - `(adminUser) => adminUser.id` (never `(a) => a.id`)
     - `(existingQuestion) => existingQuestion.id` (never `(q) => q.id`)
     - `(firstItem, secondItem) => ...` (never `(a, b) => ...`)
   - In function parameters and object payloads, use contextual identifiers:
     - `providerId` instead of generic `id`
     - `patientId` instead of generic `id`
     - `appointmentId` instead of generic `id`
     - `babyId` instead of generic `id`
     - `articleId` instead of generic `id`
     - `appointmentData`, `vitalsData`, `babyPayload` instead of generic `data` or `payload`

4. **Descriptive Functions & Handlers**:
   - Functions and event handlers must be explicitly named after their intention and domain action (e.g., `handleBackToList`, `handleToggleSelectRow`, `handleUpdateStatus`, `handleViewPatientProfile`).
   - State updater callbacks must clearly denote the transition (e.g., `setIsMobileSidebarOpen((isCurrentlyOpen) => !isCurrentlyOpen)` instead of `(v) => !v`).
