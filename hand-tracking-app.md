# Hand-Tracking Controlled Square Web App

## Project Overview

Create a web application that uses a webcam feed and hand-tracking to control a central geometric shape (a square). The app uses **MediaPipe Hands** to detect hand landmarks and translates the distance/angle between the thumb and index finger into visual properties of the shape.

---

## Tech Stack Required

- **Frontend:** HTML5, CSS3, JavaScript (ES6+)
- **Tracking Library:** MediaPipe Hands (`@mediapipe/hands`)
- **Rendering:** HTML5 Canvas API (for drawing the shape and video overlays)
- **Utility:** MediaPipe Drawing Utils and Camera Utils

---

## Core Features & Logic Breakdown

### 1. The Video Feed

- Access the user's webcam and mirror the feed (flip horizontally) for a natural mirror experience.
- Render the video to a background canvas.

### 2. Hand Detection Logic

- **Landmarks:** Focus on Landmark 4 (Thumb Tip) and Landmark 8 (Index Finger Tip) for both hands.
- **Coordinate Mapping:** Normalize hand coordinates to the canvas size.

### 3. Right Hand Control (Size & Rotation)

- **Distance Calculation:** Compute Euclidean distance between thumb and index finger.
  - **Effect:** Map distance to the **scale/size** of the square.
- **Angle Calculation:** `Math.atan2(y2 - y1, x2 - x1)` to find angle between fingers.
  - **Effect:** Apply angle to **rotation** of the square.
- **Visuals:** Draw a line connecting the thumb and index and display the distance as text.

### 4. Left Hand Control (Color / HSL)

- **Angle Calculation:** Find angle between thumb and index.
  - **Effect:** Map angle (0–360°) to **hue** of the square.
- **Distance Calculation:** Compute finger distance.
  - **Effect:** Map distance to **saturation** of the square.
- **Fixed Value:** Lightness remains constant at 50%.
- **Visuals:** Draw a line between fingers and display current hue value.

### 5. Rendering the Shape

- A central square that updates in real-time based on the **global state variables** from hand-tracking.

---

## Step-by-Step Implementation Instructions

### Setup Boilerplate

1. Create a basic HTML structure:
   - `<video>` element (hidden)
   - `<canvas>` element (fullscreen)

### Initialize MediaPipe

Import the required modules:

```javascript
import { Hands } from '@mediapipe/hands';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { Camera } from '@mediapipe/camera_utils';
```

Configure the model:

- Detect 2 hands
- Minimum detection confidence: `0.7`

### Frame Processing Loop

On every frame:

1. Clear the canvas
2. Draw mirrored video frame
3. Run `hands.send({ image: videoElement })`
4. Process results via `onResults`:
   - Iterate through `results.multiHandLandmarks` and `results.multiHandedness`
   - Identify Left vs Right hands (MediaPipe labels are mirrored)
   - Extract X, Y for landmarks 4 and 8
   - Apply distance and angle math
   - Update the `shapeConfig` object:

```javascript
const shapeConfig = { rotation, size, hue, saturation };
```

### Draw the UI

- Draw the square at the center using `shapeConfig`
- Overlay white circles on thumb and index tips
- Draw connecting lines and status text (distance/hue)

---

## UI/UX Styling

- **Background:** Dark / Minimalist
- **Typography:** Monospace font for distance/hue labels
- **Feedback:** If no hands are detected:
  - Display a "Hand Not Detected" message
  - Or keep the shape in its last known state

---

## Recommended Libraries

- [MediaPipe Hands Documentation](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)
- **Canvas API** — for high-performance 60fps rendering
- **Vector Math** — native JS math functions, or `gl-matrix` if expanding to 3D