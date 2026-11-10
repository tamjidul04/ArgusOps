import React, { Suspense } from "react";
import { Metadata } from "next";
import { DeviceClient } from "./DeviceClient";

export const metadata: Metadata = {
  title: "Connect a device",
  description: "Approve the code shown in your terminal to connect the argus CLI to your account.",
};

export default function DevicePage() {
  return (
    <Suspense fallback={null}>
      <DeviceClient />
    </Suspense>
  );
}
