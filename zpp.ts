/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import endent from "endent";
import { type z, type ZodRawShape } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type JsonSchema7Type } from "zod-to-json-schema/src/parseDef.js";

type ZodExtraMethods<In, Out, T extends z.ZodType<Out, z.ZodTypeDef, In>> = {
  new: (obj: z.infer<T>) => z.infer<T>;
  jsonParse: (data: unknown) => z.infer<T>;
  jsonParseSafe: (data: unknown) => z.SafeParseReturnType<In, Out>;
  toPrompt: () => string;
  stringify: (data: z.infer<T>) => string;
  toOpenAiFuncSchema: () => JsonSchema7Type & {
    $schema?: string | undefined;
    definitions?:
      | {
          [key: string]: JsonSchema7Type;
        }
      | undefined;
  };
};

export type ExtendedZodType<T extends z.ZodType<any, any>> = T &
  ZodExtraMethods<InType<T>, OutType<T>, T>;

type InType<T> = T extends z.ZodType<any, any, infer In> ? In : never;
type OutType<T> = T extends z.ZodType<infer Out, any, any> ? Out : never;

export function zpp<T extends z.ZodObject<any, any, any, any, any>>(
  schema: T
): ExtendedZodType<T>;

export function zpp<T extends z.ZodDiscriminatedUnion<any, any>>(
  schema: T
): ExtendedZodType<T>;

export function zpp(schema: any) {
  const newFunc = (obj: z.infer<typeof schema>) => {
    return obj;
  };

  const parseJson = (data: unknown) => {
    if (typeof data === "string") {
      return schema.parse(JSON.parse(data));
    }
    if (typeof data === "object") {
      return schema.parse(data);
    }

    throw new Error("Invalid data type");
  };

  const stringify = (data: z.infer<typeof schema>) => {
    return JSON.stringify(data);
  };

  const parseJsonSafe = (data: unknown) => {
    if (typeof data === "string") {
      return schema.safeParse(JSON.parse(data));
    }
    if (typeof data === "object") {
      return schema.safeParse(data);
    }

    throw new Error("Invalid data type");
  };

  const outputPrompt = (objectSchema: z.ZodObject<ZodRawShape>) => {
    let output = "{";

    const keys = Object.keys(objectSchema.shape);

    for (const key of keys) {
      const shape = objectSchema.shape[key];
      if (!shape) throw new Error("Invalid Shape");

      const def = shape._def;

      if (def.typeName === "ZodObject") {
        // @ts-expect-error
        output = `${output}\n"${key}": ${outputPrompt(shape)}`;
        continue;
      }

      let typeName = def.typeName;

      if (typeName === "ZodOptional") {
        typeName = def.innerType._def.typeName;
      }

      const describe: string | undefined = def.description;

      switch (typeName) {
        case "ZodString":
          output = `${output}\n"${key}": ${
            describe ? `"${describe}"` : "string"
          },`;
          break;
        case "ZodNumber":
          output = `${output}\n"${key}": number${
            describe ? ` // ${describe}` : ""
          },`;
          break;
        case "ZodBoolean":
          output = `${output}\n"${key}": boolean${
            describe ? ` // ${describe}` : ""
          },`;
          break;
      }
    }

    // Replace trailing comma
    output = output.replace(/,\s*$/, "");

    output = endent`${output}\n}`;

    return output;
  };

  const toOpenAiFuncSchema = () => {
    return zodToJsonSchema(schema);
  };

  const newSchema = Object.assign(schema, {
    new: newFunc,
    jsonParse: parseJson,
    jsonParseSafe: parseJsonSafe,
    toPrompt: () => {
      if (schema._def.typeName !== "ZodObject")
        throw new Error("Cannot use toPrompt on non-object schema");
      return outputPrompt(schema);
    },
    stringify,
    toOpenAiFuncSchema,
  });

  return newSchema;
}
