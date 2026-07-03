// Types are intentionally permissive: the runtime database is self-hosted and
// not managed by Lovable's type generator. All `.from(...)` calls return `any`
// so existing code compiles without a schema introspection step.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: Record<string, {
      Row: any;
      Insert: any;
      Update: any;
      Relationships: [];
    }>;
    Views: Record<string, { Row: any; Relationships: [] }>;
    Functions: Record<string, { Args: any; Returns: any }>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, any>;
  };
};
