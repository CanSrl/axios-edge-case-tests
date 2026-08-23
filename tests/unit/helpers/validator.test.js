import { describe, it, expect, vi } from 'vitest';
import AxiosError from '../../../lib/core/AxiosError.js';
import validator from '../../../lib/helpers/validator.js';

describe('validator::assertOptions', () => {
  it('should throw only if unknown an option was passed', () => {
    let error;
    try {
      validator.assertOptions(
        {
          x: true,
        },
        {
          y: validator.validators.boolean,
        }
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AxiosError);
    expect(error.message).toBe('Unknown option x');
    expect(error.code).toBe(AxiosError.ERR_BAD_OPTION);

    expect(() => {
      validator.assertOptions(
        {
          x: true,
        },
        {
          x: validator.validators.boolean,
          y: validator.validators.boolean,
        }
      );
    }).not.toThrow(new Error('Unknown option x'));
  });

  it("should throw TypeError only if option type doesn't match", () => {
    let error;
    try {
      validator.assertOptions(
        {
          x: 123,
        },
        {
          x: validator.validators.boolean,
        }
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AxiosError);
    expect(error.message).toBe('option x must be a boolean');
    expect(error.code).toBe(AxiosError.ERR_BAD_OPTION_VALUE);

    expect(() => {
      validator.assertOptions(
        {
          x: true,
        },
        {
          x: validator.validators.boolean,
          y: validator.validators.boolean,
        }
      );
    }).not.toThrow();
  });

  it('should reject null options', () => {
    let error;
    try {
      validator.assertOptions(null, {});
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(AxiosError);
    expect(error.message).toBe('options must be an object');
    expect(error.code).toBe(AxiosError.ERR_BAD_OPTION_VALUE);
  });
});

describe('validator::assertOptions edge cases', () => {
  it.each([
    ['undefined', undefined],
    ['a string', 'options'],
    ['a number', 0],
    ['a boolean', true],
  ])('rejects %s as the options object', (description, options) => {
    let error;

    try {
      validator.assertOptions(options, {});
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AxiosError);
    expect(error.code).toBe(AxiosError.ERR_BAD_OPTION_VALUE);
    expect(error.message).toBe('options must be an object');
  });

  it('accepts an empty options object against an empty schema', () => {
    expect(() => validator.assertOptions({}, {})).not.toThrow();
  });

  it('skips validation for an option whose value is undefined', () => {
    const check = vi.fn(() => 'never');

    expect(() => validator.assertOptions({ a: undefined }, { a: check })).not.toThrow();
    expect(check).not.toHaveBeenCalled();
  });

  it('passes the value, the option name and the options object to the validator', () => {
    const check = vi.fn(() => true);
    const options = { a: 1 };

    validator.assertOptions(options, { a: check });

    expect(check).toHaveBeenCalledWith(1, 'a', options);
  });

  it('allows unknown options when allowUnknown is true', () => {
    expect(() => validator.assertOptions({ unknown: 1 }, {}, true)).not.toThrow();
  });

  it.each([
    ['false', false],
    ['undefined', undefined],
    ['a truthy non-true value', 1],
  ])('rejects unknown options when allowUnknown is %s', (description, allowUnknown) => {
    let error;

    try {
      validator.assertOptions({ unknown: 1 }, {}, allowUnknown);
    } catch (e) {
      error = e;
    }

    expect(error.code).toBe(AxiosError.ERR_BAD_OPTION);
    expect(error.message).toBe('Unknown option unknown');
  });

  it('ignores a validator inherited from Object.prototype', () => {
    Object.prototype.polluted = () => true;

    try {
      let error;

      try {
        validator.assertOptions({ polluted: 1 }, {});
      } catch (e) {
        error = e;
      }

      expect(error.code).toBe(AxiosError.ERR_BAD_OPTION);
    } finally {
      delete Object.prototype.polluted;
    }
  });

  it('treats a falsy schema entry as an unknown option', () => {
    let error;

    try {
      validator.assertOptions({ a: 1 }, { a: null });
    } catch (e) {
      error = e;
    }

    expect(error.code).toBe(AxiosError.ERR_BAD_OPTION);
  });

  it('returns undefined when every option validates', () => {
    expect(validator.assertOptions({ a: 1 }, { a: () => true })).toBeUndefined();
  });
});

describe('validator::validators', () => {
  it.each([
    ['object', {}, true],
    ['boolean', true, true],
    ['number', 1, true],
    ['function', () => {}, true],
    ['string', 'x', true],
    ['symbol', Symbol('x'), true],
  ])('accepts a matching %s', (type, value) => {
    expect(validator.validators[type](value)).toBe(true);
  });

  it('describes the expected type when it does not match', () => {
    expect(validator.validators.number('x')).toBe('a number');
    expect(validator.validators.object(1)).toBe('an object');
  });

  it('accepts null for the object validator because typeof null is object', () => {
    expect(validator.validators.object(null)).toBe(true);
  });

  it('accepts an array for the object validator', () => {
    expect(validator.validators.object([])).toBe(true);
  });
});

describe('validator::transitional', () => {
  it('throws ERR_DEPRECATED when the option was removed', () => {
    const check = validator.validators.transitional(false, '1.0.0');
    let error;

    try {
      check(1, 'legacyOption', {});
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AxiosError);
    expect(error.code).toBe(AxiosError.ERR_DEPRECATED);
    expect(error.message).toContain("Transitional option 'legacyOption' has been removed in 1.0.0");
  });

  it('appends the extra message to the removal error', () => {
    const check = validator.validators.transitional(false, '1.0.0', 'use something else');

    expect(() => check(1, 'legacyOption', {})).toThrow(/use something else/);
  });

  it('omits the version when it was not provided', () => {
    const check = validator.validators.transitional(false);

    expect(() => check(1, 'noVersionOption', {})).toThrow(
      "Transitional option 'noVersionOption' has been removed"
    );
    expect(() => check(1, 'noVersionOption', {})).not.toThrow(/removed in/);
  });

  it('warns once per option name when a version is given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const check = validator.validators.transitional(() => true, '9.9.9');

    check(1, 'warnOnceOption', {});
    check(1, 'warnOnceOption', {});

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('warnOnceOption');

    warn.mockRestore();
  });

  it('does not warn when no version is given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const check = validator.validators.transitional(() => true);

    check(1, 'silentOption', {});

    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('returns true when no inner validator was provided', () => {
    const check = validator.validators.transitional(null);

    expect(check(1, 'passthroughOption', {})).toBe(true);
  });

  it('delegates to the inner validator', () => {
    const inner = vi.fn(() => 'a number');
    const check = validator.validators.transitional(inner);
    const options = {};

    expect(check('x', 'delegated', options)).toBe('a number');
    expect(inner).toHaveBeenCalledWith('x', 'delegated', options);
  });
});

describe('validator::spelling', () => {
  it('warns about the likely misspelling and still accepts the value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const check = validator.validators.spelling('correctName');

    expect(check(1, 'corectName')).toBe(true);
    expect(warn).toHaveBeenCalledWith('corectName is likely a misspelling of correctName');

    warn.mockRestore();
  });
});
