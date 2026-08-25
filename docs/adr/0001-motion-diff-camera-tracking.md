# Motion-diff camera tracking instead of an ML hand-tracking library

The Camera Tracker needs a Position (one x-coordinate + velocity) from the
webcam feed. The obvious choice for "webcam hand control" is a pose/hand
model such as MediaPipe Tasks Vision, which gives precise per-finger
landmarks. We use plain frame-differencing (motion energy per vertical strip,
reduced to a single centroid) instead.

Reasons: the instrument only ever needs one moving point, not a skeleton;
this is a live crit where per-frame latency and permission-prompt feel are
the biggest risks, and a multi-MB model fetch plus inference cost works
against that; and it keeps the site free of a third-party CDN dependency.
The trade-off is coarser tracking (any large motion in frame, not
specifically a hand), which is acceptable because the instrument only reads
horizontal position and speed.
