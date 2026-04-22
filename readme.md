# Quantum Orbs 🪩

An interactive WebGL experience featuring swirling quantum-inspired particles and orb-like motion. Built with Three.js, FBO, GPGPU, and custom GLSL shaders, this project focuses on real-time visuals, smooth animation, and a lightweight Vite workflow for local development and deployment.

[**✨ Watch the demo on Instagram**](https://www.instagram.com/reel/DXcN2dhElRi/)

![Quantum Orbs Animation](./assets/animated_orb.gif)

## Setup
Download [Node.js](https://nodejs.org/en/download/).
Run this followed commands:

``` bash
# Install dependencies (only the first time)
npm install

# Run the local server at localhost:8080
npm run dev

# Build for production in the dist/ directory
npm run build
```

## Debug Mode
To activate debug mode, add `#debug` at the end of the webpage URL.

Example:

```text
https://we1chj.github.io/Orbs/#debug
```

## Stack
This project is built with:

- Three.js for 3D rendering and WebGL scene management.
- JavaScript for application logic and interactivity.
- HTML for the page structure.
- CSS for styling and visual presentation.
- Vite for local development, bundling, and production builds.
