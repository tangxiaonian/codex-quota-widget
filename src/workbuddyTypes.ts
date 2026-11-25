export interface Package {
  id: string;
  name: string;
  remaining: number | null;
  total: number | null;
  expiresAt: number | null;
}
export interface WorkbuddySnapshot {
  accountKey: string;
  name: string;
  plan: string | null;
  remaining: number | null;
  total: number | null;
  used: number | null;
  packageError: string | null;
  packages: Package[];
  fetchedAt: number;
}
export interface WorkbuddyState {
  snapshot: WorkbuddySnapshot | null;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
