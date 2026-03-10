import type {
  Flatten,
  InnerSubscriber,
  Producer,
  Subscriber,
} from "./lazyPromise";
import { LazyPromise, TypedError } from "./lazyPromise";

class MapSubscriber implements Subscriber<any> {
  constructor(
    public innerSubscriber: InnerSubscriber<any>,
    public callback: (value: any) => any,
  ) {}

  resolve(value: any) {
    if (value instanceof TypedError) {
      this.innerSubscriber.resolve(value);
      return;
    }
    let newValue;
    try {
      newValue = (0, this.callback)(value);
    } catch (callbackError) {
      this.innerSubscriber.reject(callbackError);
      return;
    }
    this.innerSubscriber.resolve(newValue);
  }

  reject(error: any) {
    this.innerSubscriber.reject(error);
  }
}

class MapProducer implements Producer<any> {
  constructor(
    public source: LazyPromise<any>,
    public callback: (value: any) => any,
  ) {}

  produce(innerSubscriber: InnerSubscriber<any>) {
    return this.source.subscribe(
      new MapSubscriber(innerSubscriber, this.callback),
    );
  }
}

/**
 * The LazyPromise equivalent of `promise.then(...)`.
 */
export const map =
  <Value, NewValue>(
    callback: (
      value: Value extends TypedError<any> ? never : Value,
    ) => NewValue,
  ) =>
  (
    source: LazyPromise<Value>,
  ): LazyPromise<
    | Flatten<NewValue>
    | (Value extends TypedError<infer Error> ? TypedError<Error> : never)
  > =>
    new LazyPromise<any>(new MapProducer(source, callback));
