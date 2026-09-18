export const Rights = {
  EditGroup: 0x000001,
  ManageUsers: 0x000002,
  ManageDevices: 0x000004,
  RemoteControl: 0x000008,
  Console: 0x000010,
  ServerFiles: 0x000020,
  WakeDevice: 0x000040,
  SetNotes: 0x000080,
  ViewOnlyDesktop: 0x000100,
  NoTerminal: 0x000200,
  NoFiles: 0x000400,
  ChatNotify: 0x000800,
  Uninstall: 0x001000,
  NoDesktop: 0x002000,
  RemoteCommand: 0x004000,
  ResetOff: 0x008000,
  GuestSharing: 0x010000,
  DeviceDetails: 0x020000,
  Relay: 0x040000,
  NoRegistry: 0x080000,
  LimitedInput: 0x100000,
  LimitedEvents: 0x200000,
  Admin: 0x800000,
} as const;

export type RightsValue = number;

export const ALL_RIGHTS_BITS: readonly number[] = Object.values(Rights).filter(
  (v) => v !== Rights.Admin,
);

export const CHANNEL_RIGHTS: Record<number, number> = {
  1: Rights.Console,
  2: Rights.RemoteControl,
  3: Rights.RemoteControl,
  4: 0,
  5: Rights.ServerFiles,
  200: Rights.ChatNotify,
};
export const RIGHTS_LABELS: Array<{ bit: number; label: string }> = [
  { bit: Rights.EditGroup, label: "Edit group" },
  { bit: Rights.ManageUsers, label: "Manage users" },
  { bit: Rights.ManageDevices, label: "Manage devices" },
  { bit: Rights.RemoteControl, label: "Remote control" },
  { bit: Rights.Console, label: "Terminal" },
  { bit: Rights.ServerFiles, label: "Files" },
  { bit: Rights.WakeDevice, label: "Wake device" },
  { bit: Rights.SetNotes, label: "Set notes" },
  { bit: Rights.ViewOnlyDesktop, label: "Desktop view-only" },
  { bit: Rights.NoTerminal, label: "No terminal" },
  { bit: Rights.NoFiles, label: "No files" },
  { bit: Rights.ChatNotify, label: "Chat and notify" },
  { bit: Rights.Uninstall, label: "Allow uninstall" },
  { bit: Rights.NoDesktop, label: "No desktop" },
  { bit: Rights.RemoteCommand, label: "Remote commands" },
  { bit: Rights.ResetOff, label: "No power actions" },
  { bit: Rights.GuestSharing, label: "Guest sharing" },
  { bit: Rights.DeviceDetails, label: "Device details" },
  { bit: Rights.Relay, label: "Relay" },
  { bit: Rights.NoRegistry, label: "No registry" },
  { bit: Rights.LimitedInput, label: "Limited input" },
  { bit: Rights.LimitedEvents, label: "Limited events" },
];

export function hasRight(rights: number, bit: number): boolean {
  return (rights & bit) === bit;
}

export function canUseChannel(rights: number, channel: number): boolean {
  const required = CHANNEL_RIGHTS[channel];
  if (required === undefined) return false;
  if (channel === 1 && hasRight(rights, Rights.NoTerminal)) return false;
  if (channel === 2 && hasRight(rights, Rights.NoDesktop)) return false;
  if (channel === 5 && hasRight(rights, Rights.NoFiles)) return false;
  return (rights & required) === required;
}
