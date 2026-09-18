/**
 * Runtime API Configuration
 *
 * In local development without AWS, API_BASE_URL remains empty ('')
 * which instructs the frontend to use the built-in mock simulation (mock.js).
 *
 * During automated deployment via GitHub Actions (deploy.yaml), this file is
 * overwritten with the live deployed API Gateway HTTP API URL.
 */
window.API_BASE_URL = window.API_BASE_URL || '';
