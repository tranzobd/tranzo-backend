declare module "express" {
  export interface Request {
    method: string;
    headers: Record<string, any>;
    body: any;
    params: Record<string, string>;
    query: Record<string, any>;
    file?: any;
    ip?: string;
    get(name: string): string | undefined;
  }

  export interface Response {
    status(code: number): Response;
    json(body: any): Response;
    sendFile(path: string): void;
    setHeader(name: string, value: string): void;
    end(): void;
  }

  export type NextFunction = () => void;

  interface ExpressApp {
    use(...args: any[]): void;
    get(...args: any[]): void;
    post(...args: any[]): void;
    put(...args: any[]): void;
    delete(...args: any[]): void;
    listen(...args: any[]): void;
  }

  function express(): ExpressApp;

  namespace express {
    function json(options?: any): any;
    function urlencoded(options?: any): any;
    function static(path: string): any;
  }

  export default express;
}

declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string;
      originalname: string;
      mimetype: string;
      filename: string;
    }
  }
}

declare module "multer" {
  namespace multer {
    type FileFilterCallback = (error: Error | null, acceptFile?: boolean) => void;
  }

  interface MulterFactory {
    (options?: any): {
      single(fieldName: string): any;
    };
    diskStorage(options: any): any;
  }

  const multer: MulterFactory;
  export default multer;
  export = multer;
}

declare module "jsonwebtoken";
declare module "nodemailer";
declare module "cookie-parser";
declare module "cors";
