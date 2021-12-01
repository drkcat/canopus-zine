import { HttpService } from '@nestjs/axios';
import { CACHE_MANAGER, Inject, Injectable, Logger } from '@nestjs/common';
import { Cache } from 'cache-manager';
import {
  Cinema,
  CinemaDetails,
  Movie,
  Session,
} from 'src/models/cinema.interface';
import { ErrorResponse } from '../models/common.interface';
import { cinemas } from 'src/data/cinemas';
import { lastValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';

@Injectable()
export class CinemaService {
  private readonly logger = new Logger('CinemaService');

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private httpService: HttpService,
  ) {}

  public async getCinemas(): Promise<Cinema[] | ErrorResponse> {
    const cache: Cinema[] = await this.cacheManager.get('cinema');
    if (cache) return cache;
    const resp: Cinema[] = Object.keys(cinemas).map((id) => {
      return {
        id,
        ...cinemas[id],
      };
    });
    await this.cacheManager.set('cinema', resp, { ttl: 3600 });
    return resp;
  }

  public async getCinema(id: string): Promise<CinemaDetails | ErrorResponse> {
    if (cinemas[id]) {
      const cache: CinemaDetails = await this.cacheManager.get(`cinema/${id}`);
      if (cache) return cache;
      try {
        let movies;
        switch (id) {
          case 'palafox':
          case 'aragonia':
          case 'cervantes':
            movies = await this.getMoviesPalafox(id);
            break;
          case 'grancasa':
          case 'venecia':
            movies = await this.getMoviesCinesa(id);
            break;
          default:
            movies = [];
        }

        const resp = {
          id,
          ...cinemas[id],
          lastUpdated: new Date().toISOString(),
          movies: movies,
        };
        await this.cacheManager.set(`cinema/${id}`, resp, { ttl: 3600 });
        return resp;
      } catch (exception) {
        this.logger.error(exception.message);
        return {
          statusCode: 500,
          error: 'Internal Server Error',
          message: exception.message,
        };
      }
    } else {
      return {
        statusCode: 404,
        error: 'Not Found',
        message: `Resource with ID '${id}' was not found`,
      };
    }
  }

  public async getCinemaPro(
    id: string,
  ): Promise<CinemaDetails | ErrorResponse> {
    if (cinemas[id]) {
      const cache: CinemaDetails = await this.cacheManager.get(
        `cinema/${id}/pro`,
      );
      if (cache) return cache;
      try {
        let movies;
        switch (id) {
          case 'palafox':
          case 'aragonia':
          case 'cervantes':
            movies = await this.getMoviesPalafox(id);
            break;
          case 'grancasa':
          case 'venecia':
            movies = await this.getMoviesCinesa(id);
            break;
          default:
            movies = [];
        }

        const resp = {
          id,
          ...cinemas[id],
          lastUpdated: new Date().toISOString(),
          movies: movies,
        };
        await this.cacheManager.set(`cinema/${id}/pro`, resp, { ttl: 3600 });
        return resp;
      } catch (exception) {
        this.logger.error(exception.message);
        return {
          statusCode: 500,
          error: 'Internal Server Error',
          message: exception.message,
        };
      }
    } else {
      return {
        statusCode: 404,
        error: 'Not Found',
        message: `Resource with ID '${id}' was not found`,
      };
    }
  }

  async getMoviesPalafox(id: string): Promise<Movie[]> {
    try {
      const response = await lastValueFrom(
        this.httpService.get(cinemas[id].source),
      );
      const $ = cheerio.load(response.data);
      return (await Promise.all(
        $('.views-field-nothing')
          .map(async (_, value) => {
            const source = `https://www.cinespalafox.com${$(value)
              .find('a')
              .attr('href')}`;
            const filmResponse = await lastValueFrom(
              this.httpService.get(source),
            );
            const $2 = cheerio.load(filmResponse.data);
            const id = /cartelera\/([\w-]+)/.exec(source)[1];
            const name = $2('h1').text();
            const poster = $2('.imagecache-cartelDetalle').attr('src');
            const trailer = $2('#urlvideo').text();
            const synopsis = $2('.sinopsis p').first().text();
            const details = $2('.datos span');
            const genres = details.eq(0).text().split(', ');
            const duration = parseInt(
              details
                .eq(details.length - 3)
                .text()
                .replace(/[^\d]/g, ''),
            );
            const director = details.eq(details.length - 2).text();
            const actors = details
              .eq(details.length - 1)
              .text()
              .split(', ');
            const sessions = [];
            const schedules = $2('.horarios ul li').eq(1).find('a');
            schedules.each((index) => {
              const inputMatch = /Sala (\d+) - ([\d:]+)/.exec(
                schedules.eq(index).text(),
              );
              const session: Session = {
                time: inputMatch[2],
                room: inputMatch[1],
                url: schedules.eq(index).attr('href'),
              };
              sessions.push(session);
            });
            const movie: Movie = {
              id,
              name,
              synopsis,
              duration,
              sessions,
              director,
              actors,
              genres,
              poster,
              trailer,
              source,
            };
            return movie;
          })
          .toArray(),
      )) as any;
    } catch (exception) {
      this.logger.error(exception.message);
      return [];
    }
  }

  async getMoviesCinesa(id: string): Promise<Movie[]> {
    try {
      const response = await lastValueFrom(
        this.httpService.get(cinemas[id].source),
      );
      return response.data.cartelera[0].peliculas.map((item): Movie => {
        const sessions: Session[] = [];
        item.cines.forEach((cine) => {
          cine.tipos.forEach((tipo) => {
            tipo.salas.forEach((sala) => {
              sala.sesiones.forEach((sesion) => {
                sessions.push({
                  time: sesion.hora,
                  room: sala.sala,
                  type: sesion.tipo,
                  url: sesion.ao,
                });
              });
            });
          });
        });

        return {
          id: item.url,
          name: item.titulo,
          duration: item.duracion,
          sessions,
          director: item.directores,
          actors: item.actores.split(', '),
          genres: item.genero.split(' - '),
          poster: item.cartel,
          source: `https://www.cinesa.es/Peliculas/${item.url}`,
        };
      });
    } catch (exception) {
      this.logger.error(exception.message);
      return [];
    }
  }
}
