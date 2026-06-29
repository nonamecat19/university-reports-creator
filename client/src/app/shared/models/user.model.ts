export interface User {
  id: string;
  email: string;
  name: string;
  university?: string;
  faculty?: string;
  department?: string;
  studentGroup?: string;
  supervisor?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}
