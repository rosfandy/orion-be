export interface CreateGraphDto {
  label: string;
  props?: Record<string, unknown>;
  children?: CreateGraphChildDto[];
}

export interface UpdateGraphDto {
  label?: string;
  props?: Record<string, unknown>;
  children?: UpdateGraphChildDto[];
}

export interface UpdateGraphChildDto {
  id?: string;
  relation: string;
  label: string;
  props?: Record<string, unknown>;
}

export interface CreateGraphChildDto {
  relation: string;
  label: string;
  props?: Record<string, unknown>;
}
