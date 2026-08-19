#!/usr/bin/env python3
"""Perform Maizuo login-page mouse gestures with PyAutoGUI."""

from __future__ import annotations

import argparse
import json
import time

import pyautogui


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="action", required=True)

    subparsers.add_parser("size", help="print the primary PyAutoGUI screen size")

    drag = subparsers.add_parser("drag", help="drag the verification slider")
    drag.add_argument("--start-x", type=float, required=True)
    drag.add_argument("--start-y", type=float, required=True)
    drag.add_argument("--end-x", type=float, required=True)
    drag.add_argument("--end-y", type=float, required=True)
    drag.add_argument("--duration", type=float, default=1.5)

    click = subparsers.add_parser("click", help="click the login button")
    click.add_argument("--x", type=float, required=True)
    click.add_argument("--y", type=float, required=True)

    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.1

    if args.action == "size":
        size = pyautogui.size()
        print(json.dumps({"width": size.width, "height": size.height}))
        return

    if args.action == "drag":
        pyautogui.moveTo(args.start_x, args.start_y, duration=0.4)
        time.sleep(0.25)
        pyautogui.dragTo(
            args.end_x,
            args.end_y,
            duration=args.duration,
            button="left",
        )
        return

    pyautogui.moveTo(args.x, args.y, duration=0.4)
    pyautogui.click()


if __name__ == "__main__":
    main()
