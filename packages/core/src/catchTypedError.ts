import type {
  Flatten,
  InnerSubscriber,
  Producer,
  Subscriber,
} from "./lazyPromise";
import { LazyPromise, TypedError } from "./lazyPromise";

class CatchTypedErrorSubscriber implements Subscriber<any> {
  constructor(
    public innerSubscriber: InnerSubscriber<any>,
    public callback: (value: any) => any,
  ) {}

  resolve(value: any) {
    if (value instanceof TypedError) {
      let newValue;
      try {
        newValue = (0, this.callback)(value.error);
      } catch (callbackError) {
        this.innerSubscriber.reject(callbackError);
        return;
      }
      this.innerSubscriber.resolve(newValue);
      return;
    }
    this.innerSubscriber.resolve(value);
  }

  reject(error: any) {
    this.innerSubscriber.reject(error);
  }
}

class CatchTypedErrorProducer implements Producer<any> {
  constructor(
    public source: LazyPromise<any>,
    public callback: (value: any) => any,
  ) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    return this.source.subscribe(
      new CatchTypedErrorSubscriber(innerSubscriber, this.callback),
    );
  }
}

/**
 * The LazyPromise equivalent of `promise.catch(...)` for typed errors.
 */
export const catchTypedError =
  <Value, NewValue>(
    callback: (
      error: Value extends TypedError<infer Error> ? Error : never,
    ) => NewValue,
  ) =>
  (
    source: LazyPromise<Value>,
  ): LazyPromise<
    (Value extends TypedError<any> ? never : Value) | Flatten<NewValue>
  > =>
    new LazyPromise<any>(new CatchTypedErrorProducer(source, callback));
